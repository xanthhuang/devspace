import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { join } from "node:path";
import { openDatabase, type DatabaseHandle } from "./db/client.js";

export type DurableJobStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface ProcessIdentity {
  pid: number;
  pgid: number;
  startSignature: string;
}

export type ProcessProbeResult =
  | { state: "alive"; identity: ProcessIdentity }
  | { state: "gone" }
  | { state: "unknown"; error: string };

export interface DurableJobManagerOptions {
  platform?: NodeJS.Platform;
  probeProcess?: (pid: number) => ProcessProbeResult | Promise<ProcessProbeResult>;
  signalProcessGroup?: (pgid: number, signal: NodeJS.Signals) => void;
  terminationGraceMs?: number;
}

export interface DurableJobRecord {
  id: string;
  workspaceId: string;
  workspaceRoot: string;
  command: string;
  workingDirectory: string;
  pid: number | null;
  pgid: number | null;
  processIdentity: ProcessIdentity | null;
  status: DurableJobStatus;
  exitCode: number | null;
  signal: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  maxRuntimeSeconds: number;
  cancellationRequestedAt: number | null;
  cancellationSignalSentAt: number | null;
  cancellationVerifiedAt: number | null;
  error: string | null;
  result: string | null;
}

export interface JobLogsResult {
  jobId: string;
  content: string;
  offset: number;
  nextOffset: number;
  totalBytes: number;
  hasMore: boolean;
}

interface RawJobRow {
  id: string;
  workspace_id: string;
  workspace_root: string;
  command: string;
  working_directory: string;
  pid: number | null;
  pgid: number | null;
  process_identity: string | null;
  status: DurableJobStatus;
  exit_code: number | null;
  signal: string | null;
  log_path: string;
  marker_path: string;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  max_runtime_seconds: number;
  cancellation_requested_at: number | null;
  cancellation_signal_sent_at: number | null;
  cancellation_verified_at: number | null;
  error: string | null;
  result: string | null;
}

interface CompletionMarker {
  exitCode: number;
  signal: string | null;
  endedAt: number;
}

const DEFAULT_MAX_RUNTIME_SECONDS = 86_400;
const MAX_LOG_BYTES = 512 * 1024;
const WAIT_TAIL_BYTES = 8 * 1024;

export class DurableJobManager {
  private readonly database: DatabaseHandle;
  private readonly logsDir: string;
  private readonly metaDir: string;
  private readonly platform: NodeJS.Platform;
  private readonly probe: (pid: number) => ProcessProbeResult | Promise<ProcessProbeResult>;
  private readonly sendSignal: (pgid: number, signal: NodeJS.Signals) => void;
  private readonly terminationGraceMs: number;
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly runtimeTimers = new Map<string, NodeJS.Timeout>();
  private readonly watcher: FSWatcher;
  private readonly ready: Promise<void>;
  private closed = false;

  constructor(stateDir: string, options: DurableJobManagerOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.probe = options.probeProcess ?? probePosixProcess;
    this.sendSignal = options.signalProcessGroup
      ?? ((pgid, signal) => process.kill(-pgid, signal));
    this.terminationGraceMs = options.terminationGraceMs ?? 250;
    this.logsDir = join(stateDir, "jobs", "logs");
    this.metaDir = join(stateDir, "jobs", "meta");
    mkdirSync(this.logsDir, { recursive: true, mode: 0o700 });
    mkdirSync(this.metaDir, { recursive: true, mode: 0o700 });
    this.database = openDatabase(stateDir);
    this.watcher = watch(this.metaDir, { persistent: false }, () => {
      // Some filesystems report only the temporary side of an atomic rename.
      // Any metadata event is therefore a cue to inspect markers for running jobs.
      void this.consumeAvailableMarkers().catch(() => {
        // A concurrent manager shutdown may close the database after the event.
      });
    });
    this.watcher.on("error", () => {
      // Status reads reconcile markers, so a watcher failure cannot lose completion.
    });
    this.ready = this.reconcileAll().catch((error) => {
      // A fast server shutdown may close the database while startup
      // reconciliation is awaiting an OS process probe. Once close() owns the
      // lifecycle, that interrupted reconciliation is no longer actionable.
      if (this.closed) return;
      throw error;
    });
    // If construction is the only operation performed, a genuine startup
    // failure should still be marked handled at the process level. Any later
    // API call awaits this.ready and observes the same rejection.
    void this.ready.catch(() => undefined);
  }

  async start(input: {
    workspaceId: string;
    workspaceRoot: string;
    command: string;
    workingDirectory: string;
    maxRuntimeSeconds?: number;
    env?: NodeJS.ProcessEnv;
  }): Promise<DurableJobRecord> {
    await this.ready;
    this.assertOpen();
    if (this.platform === "win32") {
      throw new Error("Durable jobs are not supported on Windows yet.");
    }

    const id = `job_${randomUUID().replaceAll("-", "")}`;
    const logPath = join(this.logsDir, `${id}.log`);
    const markerPath = join(this.metaDir, `${id}.exit`);
    const launchPath = join(this.metaDir, `${id}.launch`);
    const abortPath = join(this.metaDir, `${id}.abort`);
    const now = Date.now();
    const maxRuntimeSeconds = input.maxRuntimeSeconds ?? DEFAULT_MAX_RUNTIME_SECONDS;
    const outputFd = openSync(logPath, "a", 0o600);
    const script = detachedScript(input.command, markerPath, launchPath, abortPath);
    let child: ChildProcess;

    try {
      child = spawn("bash", ["-c", script], {
        cwd: input.workingDirectory,
        env: { ...process.env, ...input.env, DEVSPACE_JOB_ID: id },
        detached: true,
        stdio: ["ignore", outputFd, outputFd],
      });
    } finally {
      closeSync(outputFd);
    }

    const pid = child.pid;
    if (!pid) {
      throw new Error("Failed to start durable job: detached process has no PID.");
    }

    const spawned = await waitForSpawn(child);
    if (spawned instanceof Error) {
      this.insertFailedStart({ id, input, logPath, markerPath, now, maxRuntimeSeconds, error: spawned.message });
      return this.authorizedRow(id, input.workspaceRoot);
    }

    const probed = await this.probe(pid);
    if (probed.state !== "alive" || probed.identity.pid !== pid || probed.identity.pgid !== pid) {
      writeFileSync(abortPath, "abort\n", { mode: 0o600 });
      const error = probed.state === "unknown"
        ? `Unable to establish process identity: ${probed.error}`
        : probed.state === "gone"
          ? "Detached process exited before its identity could be established."
          : "Detached process did not create its own process group.";
      this.insertFailedStart({ id, input, logPath, markerPath, now, maxRuntimeSeconds, error });
      child.unref();
      return this.authorizedRow(id, input.workspaceRoot);
    }

    this.database.sqlite.prepare(`
      insert into durable_jobs (
        id, workspace_id, workspace_root, command, working_directory,
        pid, pgid, process_identity, status, exit_code, signal,
        log_path, marker_path, created_at, started_at, ended_at,
        max_runtime_seconds, cancellation_requested_at,
        cancellation_signal_sent_at, cancellation_verified_at, error, result
      ) values (?, ?, ?, ?, ?, ?, ?, ?, 'running', null, null, ?, ?, ?, ?, null, ?, null, null, null, null, null)
    `).run(
      id,
      input.workspaceId,
      input.workspaceRoot,
      input.command,
      input.workingDirectory,
      pid,
      probed.identity.pgid,
      JSON.stringify(probed.identity),
      logPath,
      markerPath,
      now,
      now,
      maxRuntimeSeconds,
    );

    child.once("close", () => void this.handleChildClose(id));
    child.once("error", (error) => void this.failRunningJob(id, `Detached process error: ${error.message}`));
    child.unref();
    writeFileSync(launchPath, "launch\n", { mode: 0o600 });
    this.scheduleRuntime(id, now + maxRuntimeSeconds * 1_000);
    return this.authorizedRow(id, input.workspaceRoot);
  }

  async status(id: string, workspaceRoot: string): Promise<DurableJobRecord> {
    await this.ready;
    this.authorizedRow(id, workspaceRoot);
    await this.reconcileOne(id);
    return this.authorizedRow(id, workspaceRoot);
  }

  async logs(
    id: string,
    workspaceRoot: string,
    options: { offset?: number; maxBytes?: number; tail?: boolean } = {},
  ): Promise<JobLogsResult> {
    await this.status(id, workspaceRoot);
    const row = this.rawRow(id);
    const totalBytes = existsSync(row.log_path) ? statSync(row.log_path).size : 0;
    const maxBytes = Math.min(Math.max(1, options.maxBytes ?? 65_536), MAX_LOG_BYTES);
    const requestedOffset = Math.max(0, Math.trunc(options.offset ?? 0));
    const offset = options.tail && options.offset === undefined
      ? Math.max(0, totalBytes - maxBytes)
      : Math.min(requestedOffset, totalBytes);
    const bytesToRead = Math.min(maxBytes, totalBytes - offset);
    const buffer = Buffer.alloc(bytesToRead);
    let bytesRead = 0;
    if (bytesToRead > 0) {
      const fd = openSync(row.log_path, "r");
      try {
        bytesRead = readSync(fd, buffer, 0, bytesToRead, offset);
      } finally {
        closeSync(fd);
      }
    }
    const nextOffset = offset + bytesRead;
    return {
      jobId: id,
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      offset,
      nextOffset,
      totalBytes,
      hasMore: nextOffset < totalBytes,
    };
  }

  async wait(
    id: string,
    workspaceRoot: string,
    timeoutSeconds = 25,
  ): Promise<{ job: DurableJobRecord; tail: string; timedOut: boolean }> {
    await this.ready;
    const boundedSeconds = Math.min(Math.max(timeoutSeconds, 0), 45);
    let job = await this.status(id, workspaceRoot);
    if (job.status !== "running") {
      return { job, tail: (await this.logs(id, workspaceRoot, { tail: true, maxBytes: WAIT_TAIL_BYTES })).content, timedOut: false };
    }

    const completionEvent = this.waitForEvent(id, boundedSeconds * 1_000);
    // Register first, then read again so completion cannot be missed between the
    // initial status read and waiter registration.
    job = await this.status(id, workspaceRoot);
    if (job.status === "running") await completionEvent;
    else this.notify(id);
    job = await this.status(id, workspaceRoot);
    const terminal = job.status !== "running";
    return {
      job,
      tail: terminal
        ? (await this.logs(id, workspaceRoot, { tail: true, maxBytes: WAIT_TAIL_BYTES })).content
        : "",
      timedOut: !terminal,
    };
  }

  async cancel(
    id: string,
    workspaceRoot: string,
  ): Promise<{ cancelled: boolean; job: DurableJobRecord; error?: string }> {
    await this.ready;
    let job = await this.status(id, workspaceRoot);
    if (job.status !== "running") return { cancelled: job.status === "cancelled", job };
    const requestedAt = Date.now();
    this.database.sqlite.prepare(`
      update durable_jobs set cancellation_requested_at = ?, error = null
      where id = ? and status = 'running'
    `).run(requestedAt, id);

    const match = await this.matchStoredIdentity(this.rawRow(id));
    if (match.state !== "match") {
      if (match.state === "gone" || match.state === "mismatch") {
        await this.failRunningJob(id, "Process identity no longer matches the durable job; no signal was sent.");
      } else if ("error" in match) {
        this.database.sqlite.prepare("update durable_jobs set error = ? where id = ? and status = 'running'").run(
          `Unable to verify process identity; no signal was sent: ${match.error}`,
          id,
        );
      }
      job = await this.status(id, workspaceRoot);
      return {
        cancelled: false,
        job,
        error: match.state === "unknown"
          ? `Unable to verify process identity; no signal was sent: ${match.error}`
          : "Process identity did not match; no signal was sent.",
      };
    }

    try {
      this.sendSignal(match.identity.pgid, "SIGTERM");
    } catch (error) {
      const message = `Cancellation signal failed; cancellation was not confirmed: ${errorMessage(error)}`;
      this.database.sqlite.prepare("update durable_jobs set error = ? where id = ? and status = 'running'").run(message, id);
      job = await this.status(id, workspaceRoot);
      return { cancelled: false, job, error: message };
    }
    this.database.sqlite.prepare(`
      update durable_jobs set cancellation_signal_sent_at = ?
      where id = ? and status = 'running'
    `).run(Date.now(), id);

    await this.waitForEvent(id, this.terminationGraceMs);
    await this.consumeCompletionMarker(id);
    const completedAfterTerm = this.rawRow(id);
    if (completedAfterTerm.status !== "running") {
      job = this.authorizedRow(id, workspaceRoot);
      return { cancelled: job.status === "cancelled", job };
    }
    let after = await this.matchStoredIdentity(this.rawRow(id));
    if (after.state === "match") {
      try {
        this.sendSignal(after.identity.pgid, "SIGKILL");
      } catch (error) {
        const message = `Cancellation escalation failed; cancellation was not confirmed: ${errorMessage(error)}`;
        this.database.sqlite.prepare("update durable_jobs set error = ? where id = ? and status = 'running'").run(message, id);
        job = await this.status(id, workspaceRoot);
        return { cancelled: false, job, error: message };
      }
      await this.waitForEvent(id, 1_000);
      await this.consumeCompletionMarker(id);
      after = await this.matchStoredIdentity(this.rawRow(id));
    }

    if (after.state === "gone" || after.state === "mismatch") {
      this.markCancelled(id);
      this.notify(id);
    } else if (after.state === "unknown") {
      const message = `Cancellation signal was sent, but process termination could not be verified: ${after.error}`;
      this.database.sqlite.prepare("update durable_jobs set error = ? where id = ? and status = 'running'").run(message, id);
      job = await this.status(id, workspaceRoot);
      return { cancelled: false, job, error: message };
    }

    job = await this.status(id, workspaceRoot);
    return { cancelled: job.status === "cancelled", job };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.watcher.close();
    for (const timer of this.runtimeTimers.values()) clearTimeout(timer);
    this.runtimeTimers.clear();
    for (const callbacks of this.waiters.values()) {
      for (const callback of callbacks) callback();
    }
    this.waiters.clear();
    this.database.close();
  }

  private async reconcileAll(): Promise<void> {
    const rows = this.database.sqlite.prepare("select * from durable_jobs where status = 'running'").all() as RawJobRow[];
    for (const row of rows) await this.reconcileOne(row.id);
  }

  private async consumeAvailableMarkers(): Promise<void> {
    if (this.closed) return;
    const rows = this.database.sqlite.prepare("select id from durable_jobs where status = 'running'").all() as Array<{ id: string }>;
    for (const { id } of rows) {
      if (await this.consumeCompletionMarker(id)) this.notify(id);
    }
  }

  private async reconcileOne(id: string): Promise<void> {
    if (await this.consumeCompletionMarker(id)) return;
    const row = this.rawRowOrUndefined(id);
    if (!row || row.status !== "running") return;
    const match = await this.matchStoredIdentity(row);
    if (match.state === "gone" || match.state === "mismatch") {
      if (row.cancellation_signal_sent_at !== null) this.markCancelled(id);
      else await this.failRunningJob(id, "Process ended without a completion marker or its identity changed.");
      this.notify(id);
      return;
    }
    if (match.state === "unknown") return;
    // A server crash can occur after the durable row is committed but before
    // the parent releases the launch gate. Once the persisted identity is
    // verified, a restarted manager can safely release that same job.
    this.releaseLaunchGate(id);
    const deadline = (row.started_at ?? row.created_at) + row.max_runtime_seconds * 1_000;
    if (Date.now() >= deadline) await this.enforceRuntimeLimit(row);
    else this.scheduleRuntime(id, deadline);
  }

  private async enforceRuntimeLimit(row: RawJobRow): Promise<void> {
    const match = await this.matchStoredIdentity(row);
    if (match.state !== "match") {
      if (match.state === "gone" || match.state === "mismatch") {
        await this.failRunningJob(row.id, "Job exceeded its maximum runtime and the original process is no longer present.");
      }
      return;
    }
    try {
      this.sendSignal(match.identity.pgid, "SIGTERM");
    } catch (error) {
      this.database.sqlite.prepare("update durable_jobs set error = ? where id = ? and status = 'running'").run(
        `Job exceeded its maximum runtime, but termination failed: ${errorMessage(error)}`,
        row.id,
      );
      return;
    }
    await this.waitForEvent(row.id, this.terminationGraceMs);
    if (await this.consumeCompletionMarker(row.id, "Job exceeded its maximum runtime.")) {
      this.notify(row.id);
      return;
    }
    const after = await this.matchStoredIdentity(this.rawRow(row.id));
    if (after.state === "match") {
      try {
        this.sendSignal(after.identity.pgid, "SIGKILL");
      } catch (error) {
        this.database.sqlite.prepare("update durable_jobs set error = ? where id = ? and status = 'running'").run(
          `Job exceeded its maximum runtime, but escalation failed: ${errorMessage(error)}`,
          row.id,
        );
        return;
      }
    }
    await this.waitForEvent(row.id, 1_000);
    await this.consumeCompletionMarker(row.id, "Job exceeded its maximum runtime.");
    const final = await this.matchStoredIdentity(this.rawRow(row.id));
    if (final.state === "gone" || final.state === "mismatch") {
      await this.failRunningJob(row.id, "Job exceeded its maximum runtime.");
    }
  }

  private async consumeCompletionMarker(id: string, forcedError?: string): Promise<boolean> {
    const row = this.rawRowOrUndefined(id);
    if (!row || row.status !== "running" || !existsSync(row.marker_path)) return false;
    let marker: CompletionMarker;
    try {
      marker = JSON.parse(readFileSync(row.marker_path, "utf8")) as CompletionMarker;
      if (!Number.isInteger(marker.exitCode) || !Number.isFinite(marker.endedAt)) throw new Error("invalid marker");
    } catch {
      return false;
    }
    const cancelled = row.cancellation_signal_sent_at !== null;
    if (cancelled) {
      const identity = await this.matchStoredIdentity(row);
      if (identity.state === "match" || identity.state === "unknown") return false;
    }
    const status: DurableJobStatus = cancelled ? "cancelled" : marker.exitCode === 0 ? "succeeded" : "failed";
    this.database.sqlite.prepare(`
      update durable_jobs
      set status = ?, exit_code = ?, signal = ?, ended_at = ?,
          cancellation_verified_at = case when ? then ? else cancellation_verified_at end,
          error = ?, result = ?
      where id = ? and status = 'running'
    `).run(
      status,
      marker.exitCode,
      marker.signal,
      marker.endedAt,
      cancelled ? 1 : 0,
      cancelled ? Date.now() : null,
      forcedError ?? (status === "failed" ? `Command exited with code ${marker.exitCode}.` : null),
      status === "succeeded" ? "Command completed successfully." : null,
      id,
    );
    this.clearRuntime(id);
    return true;
  }

  private async handleChildClose(id: string): Promise<void> {
    if (this.closed) return;
    if (await this.consumeCompletionMarker(id)) this.notify(id);
    else await this.reconcileOne(id);
  }

  private async matchStoredIdentity(row: RawJobRow): Promise<
    | { state: "match"; identity: ProcessIdentity }
    | { state: "gone" | "mismatch" }
    | { state: "unknown"; error: string }
  > {
    if (!row.pid || !row.process_identity) return { state: "mismatch" };
    let stored: ProcessIdentity;
    try {
      stored = JSON.parse(row.process_identity) as ProcessIdentity;
    } catch {
      return { state: "mismatch" };
    }
    const current = await this.probe(row.pid);
    if (current.state !== "alive") return current;
    return sameIdentity(stored, current.identity)
      ? { state: "match", identity: current.identity }
      : { state: "mismatch" };
  }

  private markCancelled(id: string): void {
    const now = Date.now();
    this.database.sqlite.prepare(`
      update durable_jobs
      set status = 'cancelled', ended_at = ?, cancellation_verified_at = ?,
          error = null, result = 'Cancellation verified after the original process exited.'
      where id = ? and status = 'running' and cancellation_signal_sent_at is not null
    `).run(now, now, id);
    this.clearRuntime(id);
  }

  private async failRunningJob(id: string, error: string): Promise<void> {
    if (this.closed) return;
    const changed = this.database.sqlite.prepare(`
      update durable_jobs set status = 'failed', ended_at = ?, error = ?
      where id = ? and status = 'running'
    `).run(Date.now(), error, id).changes;
    if (changed > 0) {
      this.clearRuntime(id);
      this.notify(id);
    }
  }

  private insertFailedStart(input: {
    id: string;
    input: { workspaceId: string; workspaceRoot: string; command: string; workingDirectory: string };
    logPath: string;
    markerPath: string;
    now: number;
    maxRuntimeSeconds: number;
    error: string;
  }): void {
    this.database.sqlite.prepare(`
      insert into durable_jobs (
        id, workspace_id, workspace_root, command, working_directory,
        pid, pgid, process_identity, status, exit_code, signal,
        log_path, marker_path, created_at, started_at, ended_at,
        max_runtime_seconds, cancellation_requested_at,
        cancellation_signal_sent_at, cancellation_verified_at, error, result
      ) values (?, ?, ?, ?, ?, null, null, null, 'failed', null, null, ?, ?, ?, ?, ?, ?, null, null, null, ?, null)
    `).run(
      input.id,
      input.input.workspaceId,
      input.input.workspaceRoot,
      input.input.command,
      input.input.workingDirectory,
      input.logPath,
      input.markerPath,
      input.now,
      input.now,
      input.now,
      input.maxRuntimeSeconds,
      input.error,
    );
  }

  private authorizedRow(id: string, workspaceRoot: string): DurableJobRecord {
    const row = this.rawRowOrUndefined(id);
    if (!row || row.workspace_root !== workspaceRoot) {
      throw new Error(`Durable job ${id} was not found for this workspace root.`);
    }
    return toRecord(row);
  }

  private rawRow(id: string): RawJobRow {
    const row = this.rawRowOrUndefined(id);
    if (!row) throw new Error(`Durable job ${id} was not found.`);
    return row;
  }

  private rawRowOrUndefined(id: string): RawJobRow | undefined {
    return this.database.sqlite.prepare("select * from durable_jobs where id = ?").get(id) as RawJobRow | undefined;
  }

  private scheduleRuntime(id: string, deadline: number): void {
    if (this.closed || this.runtimeTimers.has(id)) return;
    const delay = Math.max(0, deadline - Date.now());
    const timer = setTimeout(() => {
      this.runtimeTimers.delete(id);
      void this.reconcileOne(id);
    }, Math.min(delay, 2_147_483_647));
    timer.unref();
    this.runtimeTimers.set(id, timer);
  }

  private clearRuntime(id: string): void {
    const timer = this.runtimeTimers.get(id);
    if (timer) clearTimeout(timer);
    this.runtimeTimers.delete(id);
  }

  private waitForEvent(id: string, timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0 || this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const callbacks = this.waiters.get(id) ?? new Set<() => void>();
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callbacks.delete(finish);
        if (callbacks.size === 0) this.waiters.delete(id);
        resolve();
      };
      callbacks.add(finish);
      this.waiters.set(id, callbacks);
      const timer = setTimeout(finish, timeoutMs);
      timer.unref();
    });
  }

  private notify(id: string): void {
    for (const callback of [...(this.waiters.get(id) ?? [])]) callback();
  }

  private releaseLaunchGate(id: string): void {
    const launchPath = join(this.metaDir, `${id}.launch`);
    if (existsSync(launchPath)) return;
    try {
      writeFileSync(launchPath, "launch\n", { mode: 0o600 });
    } catch {
      // A later reconciliation retries. Do not invent terminal state or signal
      // a process merely because the launch-gate file could not be written.
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Durable job manager is closed.");
  }
}

export function probePosixProcess(pid: number): ProcessProbeResult {
  if (process.platform === "win32") {
    return { state: "unknown", error: "POSIX process identity is unavailable on Windows." };
  }
  try {
    const output = execFileSync("ps", ["-p", String(pid), "-o", "lstart=", "-o", "pgid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!output) return { state: "gone" };
    const matched = /^(.*\S)\s+(\d+)\s*$/.exec(output);
    if (!matched) return { state: "unknown", error: "ps returned an unrecognized process identity." };
    return {
      state: "alive",
      identity: { pid, startSignature: matched[1]!, pgid: Number(matched[2]) },
    };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) return { state: "gone" };
    return { state: "unknown", error: errorMessage(error) };
  }
}

function detachedScript(command: string, markerPath: string, launchPath: string, abortPath: string): string {
  return `
__devspace_write_marker() {
  __devspace_ec="$1"
  __devspace_signal="$2"
  __devspace_now=$(node -e 'process.stdout.write(String(Date.now()))')
  __devspace_tmp=${shellQuote(`${markerPath}.tmp.$$`)}
  if [ "$__devspace_signal" = "null" ]; then
    __devspace_signal_json=null
  else
    __devspace_signal_json="\\\"$__devspace_signal\\\""
  fi
  printf '{"exitCode":%s,"signal":%s,"endedAt":%s}\n' "$__devspace_ec" "$__devspace_signal_json" "$__devspace_now" > "$__devspace_tmp"
  mv -f "$__devspace_tmp" ${shellQuote(markerPath)}
  rm -f ${shellQuote(launchPath)} ${shellQuote(abortPath)}
}
__devspace_finish() {
  __devspace_ec=$?
  __devspace_write_marker "$__devspace_ec" null
}
__devspace_on_signal() {
  trap - EXIT
  __devspace_write_marker "$2" "$1"
  exit "$2"
}
trap __devspace_finish EXIT
trap '__devspace_on_signal SIGTERM 143' TERM
trap '__devspace_on_signal SIGINT 130' INT
trap '__devspace_on_signal SIGHUP 129' HUP
__devspace_gate_deadline=$(( $(date +%s) + 30 ))
while [ ! -f ${shellQuote(launchPath)} ]; do
  [ -f ${shellQuote(abortPath)} ] && exit 125
  [ "$(date +%s)" -ge "$__devspace_gate_deadline" ] && exit 125
  sleep 0.01
done
(
${command}
)
`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function waitForSpawn(child: ChildProcess): Promise<true | Error> {
  if (child.pid !== undefined && child.spawnfile) return Promise.resolve(true);
  return new Promise((resolve) => {
    child.once("spawn", () => resolve(true));
    child.once("error", (error) => resolve(error));
  });
}

function sameIdentity(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return left.pid === right.pid
    && left.pgid === right.pgid
    && left.startSignature === right.startSignature;
}

function toRecord(row: RawJobRow): DurableJobRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceRoot: row.workspace_root,
    command: row.command,
    workingDirectory: row.working_directory,
    pid: row.pid,
    pgid: row.pgid,
    processIdentity: row.process_identity ? JSON.parse(row.process_identity) as ProcessIdentity : null,
    status: row.status,
    exitCode: row.exit_code,
    signal: row.signal,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    maxRuntimeSeconds: row.max_runtime_seconds,
    cancellationRequestedAt: row.cancellation_requested_at,
    cancellationSignalSentAt: row.cancellation_signal_sent_at,
    cancellationVerifiedAt: row.cancellation_verified_at,
    error: row.error,
    result: row.result,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
