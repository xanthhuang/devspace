import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  DurableJobManager,
  type ProcessProbeResult,
} from "./durable-jobs.js";

test("durable job starts immediately, completes, and exposes logs and exit code", async (t) => {
  const fixture = managerFixture(t);
  const started = await fixture.manager.start(startInput(fixture.root, "printf 'line-one\\nline-two\\n'"));
  assert.match(started.id, /^job_[0-9a-f]{32}$/);
  assert.ok(started.status === "running" || started.status === "succeeded");
  await access(join(fixture.root, "devspace.sqlite"));
  await assert.rejects(access(join(fixture.root, "jobs", "jobs.sqlite")));

  const waited = await fixture.manager.wait(started.id, fixture.root, 5);
  assert.equal(waited.job.status, "succeeded");
  assert.equal(waited.job.exitCode, 0);
  assert.match(waited.tail, /line-one/);
  assert.match(waited.tail, /line-two/);
});

test("durable job works with the real POSIX process identity probe", async (t) => {
  if (process.platform === "win32") return;
  const root = mkdtempSync(join(tmpdir(), "devspace-durable-real-probe-"));
  const manager = new DurableJobManager(root);
  t.after(async () => {
    manager.close();
    await rm(root, { recursive: true, force: true });
  });
  const started = await manager.start(startInput(root, "printf 'real-probe\\n'"));
  const waited = await manager.wait(started.id, root, 5);
  assert.equal(waited.job.status, "succeeded");
  assert.match(waited.tail, /real-probe/);
});

test("a new manager recovers a detached job from the main state DB and completion marker", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "devspace-durable-restart-"));
  const first = new DurableJobManager(root, { probeProcess: stableTestProbe });
  t.after(async () => rm(root, { recursive: true, force: true }));
  const started = await first.start(startInput(root, "sleep 0.15; printf 'survived\\n'"));
  first.close();

  const second = new DurableJobManager(root, { probeProcess: stableTestProbe });
  t.after(() => second.close());
  const recovered = await waitForTerminal(second, started.id, root);
  assert.equal(recovered.status, "succeeded");
  assert.equal(recovered.exitCode, 0);
  assert.match((await second.logs(started.id, root)).content, /survived/);
});

test("mismatched process identity fails closed and sends no signal", async (t) => {
  let mismatch = false;
  const signals: string[] = [];
  const fixture = managerFixture(t, {
    probeProcess: (pid) => aliveIdentity(pid, mismatch ? "different" : "original"),
    signalProcessGroup: (_pgid, signal) => signals.push(signal),
  });
  const started = await fixture.manager.start(startInput(fixture.root, "sleep 0.2"));
  mismatch = true;

  const cancelled = await fixture.manager.cancel(started.id, fixture.root);
  assert.equal(cancelled.cancelled, false);
  assert.equal(cancelled.job.status, "failed");
  assert.deepEqual(signals, []);
});

test("job access is scoped to canonical root but independent of workspace id", async (t) => {
  let mismatch = false;
  const fixture = managerFixture(t, {
    probeProcess: (pid) => aliveIdentity(pid, mismatch ? "different" : "original"),
  });
  const started = await fixture.manager.start({
    ...startInput(fixture.root, "sleep 0.3"),
    workspaceId: "workspace-original",
  });
  assert.equal((await fixture.manager.status(started.id, fixture.root)).id, started.id);
  mismatch = true;
  await assert.rejects(
    fixture.manager.status(started.id, join(fixture.root, "other")),
    /not found for this workspace root/,
  );
  // Authorization must happen before reconciliation because reconcile can
  // mutate state or enforce a runtime limit. A foreign root must not be able
  // to turn a healthy job into failed state merely by knowing its id.
  mismatch = false;
  assert.equal((await fixture.manager.status(started.id, fixture.root)).status, "running");
  await fixture.manager.wait(started.id, fixture.root, 1);
});

test("cancel reports cancelled only after a signalled process is verified gone", async (t) => {
  let gone = false;
  const fixture = managerFixture(t, {
    probeProcess: (pid) => gone ? { state: "gone" } : aliveIdentity(pid, "stable"),
    signalProcessGroup: () => { gone = true; },
    terminationGraceMs: 1,
  });
  const started = await fixture.manager.start(startInput(fixture.root, "sleep 0.2"));
  const result = await fixture.manager.cancel(started.id, fixture.root);
  assert.equal(result.cancelled, true);
  assert.equal(result.job.status, "cancelled");
  assert.ok(result.job.cancellationSignalSentAt);
  assert.ok(result.job.cancellationVerifiedAt);
});

test("real POSIX cancellation writes a valid signal completion marker", async (t) => {
  if (process.platform === "win32") return;
  const root = mkdtempSync(join(tmpdir(), "devspace-durable-signal-marker-"));
  const manager = new DurableJobManager(root);
  t.after(async () => {
    manager.close();
    await rm(root, { recursive: true, force: true });
  });
  const started = await manager.start(startInput(root, "sleep 30"));
  const cancelled = await manager.cancel(started.id, root);
  assert.equal(cancelled.cancelled, true);
  const markerPath = join(root, "jobs", "meta", `${started.id}.exit`);
  const markerText = await waitForFile(markerPath);
  const marker = JSON.parse(markerText) as { exitCode: number; signal: string | null; endedAt: number };
  assert.equal(marker.exitCode, 143);
  assert.equal(marker.signal, "SIGTERM");
  assert.ok(Number.isFinite(marker.endedAt));
});

test("signal failure and unknown identity never report cancelled", async (t) => {
  await t.test("signal failure", async (nested) => {
    const fixture = managerFixture(nested, {
      probeProcess: (pid) => aliveIdentity(pid, "stable"),
      signalProcessGroup: () => { throw new Error("denied"); },
    });
    const started = await fixture.manager.start(startInput(fixture.root, "sleep 0.2"));
    const result = await fixture.manager.cancel(started.id, fixture.root);
    assert.equal(result.cancelled, false);
    assert.notEqual(result.job.status, "cancelled");
    assert.match(result.error ?? "", /not confirmed/);
  });

  await t.test("unknown identity", async (nested) => {
    let unknown = false;
    let signals = 0;
    const fixture = managerFixture(nested, {
      probeProcess: (pid) => unknown
        ? { state: "unknown", error: "probe unavailable" }
        : aliveIdentity(pid, "stable"),
      signalProcessGroup: () => { signals += 1; },
    });
    const started = await fixture.manager.start(startInput(fixture.root, "sleep 0.2"));
    unknown = true;
    const result = await fixture.manager.cancel(started.id, fixture.root);
    assert.equal(result.cancelled, false);
    assert.notEqual(result.job.status, "cancelled");
    assert.equal(signals, 0);
  });
});

test("job_wait wakes on completion event without a polling interval", async (t) => {
  const fixture = managerFixture(t);
  const completionTimePath = join(fixture.root, "completed-at");
  const started = await fixture.manager.start(startInput(
    fixture.root,
    `sleep 0.15; node -e "require('node:fs').writeFileSync('${completionTimePath}', String(Date.now()))"`,
  ));
  const waited = await fixture.manager.wait(started.id, fixture.root, 5);
  const completionTime = Number(await readFile(completionTimePath, "utf8"));
  assert.equal(waited.job.status, "succeeded");
  assert.ok(Date.now() - completionTime < 100, `wait woke ${Date.now() - completionTime}ms after completion`);
});

test("byte-offset log pagination preserves every byte including blank lines", async (t) => {
  const fixture = managerFixture(t);
  const expected = "\nvisible\n\nlast\n";
  const started = await fixture.manager.start(startInput(fixture.root, `printf '${expected.replaceAll("\n", "\\n")}'`));
  await fixture.manager.wait(started.id, fixture.root, 5);
  let offset = 0;
  let collected = "";
  do {
    const page = await fixture.manager.logs(started.id, fixture.root, { offset, maxBytes: 3 });
    collected += page.content;
    offset = page.nextOffset;
    if (!page.hasMore) break;
  } while (true);
  assert.equal(collected, expected);
});

test("Windows durable job start fails explicitly as unsupported", async (t) => {
  const fixture = managerFixture(t, { platform: "win32" });
  await assert.rejects(
    fixture.manager.start(startInput(fixture.root, "echo no")),
    /not supported on Windows yet/,
  );
});

test("closing during startup reconciliation does not emit an unhandled rejection", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "devspace-durable-close-race-"));
  const first = new DurableJobManager(root, { probeProcess: stableTestProbe });
  const started = await first.start(startInput(root, "sleep 0.3"));
  first.close();

  let rejectProbe!: (error: Error) => void;
  let markProbeStarted!: () => void;
  const probeStarted = new Promise<void>((resolve) => {
    markProbeStarted = resolve;
  });
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  const second = new DurableJobManager(root, {
    probeProcess: () => {
      markProbeStarted();
      return new Promise<ProcessProbeResult>((_resolve, reject) => {
        rejectProbe = reject;
      });
    },
  });
  await probeStarted;
  second.close();
  rejectProbe(new Error("probe closed during reconciliation"));
  await new Promise((resolve) => setTimeout(resolve, 25));
  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(unhandled, []);

  const cleanup = new DurableJobManager(root, { probeProcess: () => ({ state: "gone" }) });
  await cleanup.status(started.id, root).catch(() => undefined);
  cleanup.close();
  await rm(root, { recursive: true, force: true });
  t.after(() => process.off("unhandledRejection", onUnhandled));
});

function managerFixture(
  t: TestContext,
  options: ConstructorParameters<typeof DurableJobManager>[1] = {},
): { root: string; manager: DurableJobManager } {
  const root = mkdtempSync(join(tmpdir(), "devspace-durable-test-"));
  const manager = new DurableJobManager(root, {
    probeProcess: stableTestProbe,
    ...options,
  });
  t.after(async () => {
    manager.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, manager };
}

function startInput(root: string, command: string) {
  return {
    workspaceId: "workspace-test",
    workspaceRoot: root,
    command,
    workingDirectory: root,
  };
}

function aliveIdentity(pid: number, startSignature: string): ProcessProbeResult {
  return { state: "alive", identity: { pid, pgid: pid, startSignature } };
}

function stableTestProbe(pid: number): ProcessProbeResult {
  return aliveIdentity(pid, "test-process-start");
}

async function waitForTerminal(
  manager: DurableJobManager,
  jobId: string,
  workspaceRoot: string,
): Promise<Awaited<ReturnType<DurableJobManager["status"]>>> {
  const deadline = Date.now() + 2_000;
  let job = await manager.status(jobId, workspaceRoot);
  while (job.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    job = await manager.status(jobId, workspaceRoot);
  }
  return job;
}

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}.`);
}
