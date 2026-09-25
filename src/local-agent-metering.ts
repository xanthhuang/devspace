import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { LocalAgentProvider } from "./local-agent-profiles.js";

export const CCUSAGE_METER = "ccusage";
export const CCUSAGE_VERSION = "20.0.24";
export const CODEX_JSONL_METER = "codex-jsonl";
const CCUSAGE_TIMEOUT_MS = 10_000;

export interface LocalAgentUsageModelSnapshot {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

export interface LocalAgentUsageSnapshot {
  provider: LocalAgentProvider;
  providerSessionId: string;
  meter: string;
  meterVersion: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  totalCost: number;
  modelBreakdowns: LocalAgentUsageModelSnapshot[];
}

export interface LocalAgentUsageMeter {
  snapshot(
    provider: LocalAgentProvider,
    providerSessionId: string,
  ): Promise<LocalAgentUsageSnapshot | undefined>;
}

export class LocalAgentUsageMeterChain implements LocalAgentUsageMeter {
  constructor(private readonly meters: readonly LocalAgentUsageMeter[]) {}

  async snapshot(
    provider: LocalAgentProvider,
    providerSessionId: string,
  ): Promise<LocalAgentUsageSnapshot | undefined> {
    for (const meter of this.meters) {
      const snapshot = await meter.snapshot(provider, providerSessionId);
      if (snapshot) return snapshot;
    }
    return undefined;
  }
}

type CcusageExecutor = (
  command: string,
  args: readonly string[],
) => Promise<{ stdout: string }>;

export interface CcusageMeterOptions {
  env?: NodeJS.ProcessEnv;
  command?: string;
  execute?: CcusageExecutor;
}

export class CcusageMeter implements LocalAgentUsageMeter {
  private readonly command: string;
  private readonly execute: CcusageExecutor;
  private versionPromise?: Promise<string>;

  constructor(options: CcusageMeterOptions = {}) {
    this.command = options.command ?? resolveCcusageCommand(options.env ?? process.env);
    this.execute = options.execute ?? defaultCcusageExecutor;
  }

  async snapshot(
    provider: LocalAgentProvider,
    providerSessionId: string,
  ): Promise<LocalAgentUsageSnapshot | undefined> {
    if (provider !== "claude") return undefined;
    const meterVersion = await this.version();
    const { stdout } = await this.execute(this.command, [
      "claude",
      "session",
      "--json",
      "--offline",
      "--mode",
      "calculate",
    ]);
    const snapshot = parseCcusageSessionSnapshot(stdout, providerSessionId);
    if (!snapshot) {
      throw new Error(`ccusage did not report Claude session ${providerSessionId}.`);
    }
    return { ...snapshot, meterVersion };
  }

  private version(): Promise<string> {
    if (!this.versionPromise) {
      this.versionPromise = this.execute(this.command, ["--version"])
        .then(({ stdout }) => {
          const match = /^ccusage\s+(\S+)\s*$/u.exec(stdout.trim());
          if (!match) throw new Error("ccusage --version returned an unexpected value.");
          const version = match[1]!;
          if (version !== CCUSAGE_VERSION) {
            throw new Error(`ccusage version mismatch: expected ${CCUSAGE_VERSION}, got ${version}.`);
          }
          return version;
        })
        .catch((error) => {
          this.versionPromise = undefined;
          throw error;
        });
    }
    return this.versionPromise;
  }
}

export interface CodexJsonlMeterOptions {
  env?: NodeJS.ProcessEnv;
  sessionsRoot?: string;
}

/**
 * Reads Codex's own durable rollout JSONL. Current Codex app-server and
 * `codex exec --json` both originate from the same structured usage data, while
 * the rollout log additionally preserves cumulative thread usage needed for
 * lossless per-turn deltas after daemon restarts.
 */
export class CodexJsonlMeter implements LocalAgentUsageMeter {
  private readonly sessionsRoot: string;
  private readonly sessionFiles = new Map<string, string>();

  constructor(options: CodexJsonlMeterOptions = {}) {
    this.sessionsRoot = options.sessionsRoot ?? resolveCodexSessionsRoot(options.env ?? process.env);
  }

  async snapshot(
    provider: LocalAgentProvider,
    providerSessionId: string,
  ): Promise<LocalAgentUsageSnapshot | undefined> {
    if (provider !== "codex") return undefined;
    const path = this.sessionFiles.get(providerSessionId)
      ?? await findCodexSessionLog(this.sessionsRoot, providerSessionId);
    if (!path) throw new Error(`Codex JSONL session log not found for ${providerSessionId}.`);
    this.sessionFiles.set(providerSessionId, path);
    return parseCodexSessionSnapshot(await readFile(path, "utf8"), providerSessionId);
  }
}

export function resolveCodexSessionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const codexHome = resolve(env.CODEX_HOME?.trim() || join(homedir(), ".codex"));
  return join(codexHome, "sessions");
}

export function parseCodexSessionSnapshot(
  jsonl: string,
  providerSessionId: string,
): LocalAgentUsageSnapshot | undefined {
  let meterVersion = "unknown";
  let threadUsage: CodexTokenUsage | undefined;
  const modelsByTurn = new Map<string, string>();
  const usageByTurn = new Map<string, CodexTokenUsage>();

  for (const [index, line] of jsonl.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch (cause) {
      throw new Error(`Codex JSONL line ${index + 1} was not valid JSON.`, { cause });
    }
    const type = event.type;
    const payload = record(event.payload);
    if (!payload) continue;
    if (type === "session_meta") {
      const sessionId = directString(payload.session_id) ?? directString(payload.id);
      if (sessionId && sessionId !== providerSessionId) continue;
      meterVersion = directString(payload.cli_version) ?? meterVersion;
      continue;
    }
    if (type === "turn_context") {
      const turnId = directString(payload.turn_id);
      const model = directString(payload.model);
      if (turnId && model) modelsByTurn.set(turnId, model);
      continue;
    }
    if (type !== "token_usage_record") continue;
    const sessionId = directString(payload.session_id) ?? directString(payload.thread_id);
    if (sessionId && sessionId !== providerSessionId) continue;
    const turnId = directString(payload.turn_id) ?? directString(payload.root_turn_id);
    const turn = parseCodexTokenUsage(payload.turn_token_usage ?? payload.usage);
    if (turnId && turn) usageByTurn.set(turnId, turn);
    threadUsage = parseCodexTokenUsage(payload.thread_token_usage) ?? threadUsage;
  }

  if (!threadUsage && usageByTurn.size === 0) return undefined;
  const aggregate = threadUsage ?? sumCodexUsage(Array.from(usageByTurn.values()));
  const modelGroups = new Map<string, CodexTokenUsage>();
  for (const [turnId, usage] of usageByTurn) {
    const model = modelsByTurn.get(turnId) ?? "unknown";
    modelGroups.set(model, sumCodexUsage([modelGroups.get(model), usage].filter(Boolean) as CodexTokenUsage[]));
  }
  return {
    provider: "codex",
    providerSessionId,
    meter: CODEX_JSONL_METER,
    meterVersion,
    inputTokens: aggregate.inputTokens,
    outputTokens: aggregate.outputTokens,
    cacheCreationTokens: aggregate.cacheCreationTokens,
    cacheReadTokens: aggregate.cacheReadTokens,
    totalTokens: aggregate.totalTokens,
    // Codex CLI JSON usage does not expose a canonical price. Preserve token
    // accounting and leave monetary estimation to a separate pricing layer.
    totalCost: 0,
    modelBreakdowns: Array.from(modelGroups, ([modelName, usage]) => ({
      modelName,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cost: 0,
    })),
  };
}

interface CodexTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

function parseCodexTokenUsage(value: unknown): CodexTokenUsage | undefined {
  const usage = record(value);
  if (!usage) return undefined;
  const inputTokens = optionalNonNegativeNumber(usage, "input_tokens") ?? 0;
  const outputTokens = optionalNonNegativeNumber(usage, "output_tokens") ?? 0;
  const cacheCreationTokens = optionalNonNegativeNumber(usage, "cache_write_input_tokens") ?? 0;
  const cacheReadTokens = optionalNonNegativeNumber(usage, "cached_input_tokens") ?? 0;
  const totalTokens = optionalNonNegativeNumber(usage, "total_tokens") ?? inputTokens + outputTokens;
  return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, totalTokens };
}

function sumCodexUsage(values: readonly CodexTokenUsage[]): CodexTokenUsage {
  return values.reduce<CodexTokenUsage>((total, value) => ({
    inputTokens: total.inputTokens + value.inputTokens,
    outputTokens: total.outputTokens + value.outputTokens,
    cacheCreationTokens: total.cacheCreationTokens + value.cacheCreationTokens,
    cacheReadTokens: total.cacheReadTokens + value.cacheReadTokens,
    totalTokens: total.totalTokens + value.totalTokens,
  }), { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0 });
}

async function findCodexSessionLog(root: string, providerSessionId: string): Promise<string | undefined> {
  const suffix = `${providerSessionId}.jsonl`;
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      const code = record(error)?.code;
      if (code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(suffix)) return path;
    }
  }
  return undefined;
}

export function resolveCcusageCommand(env: NodeJS.ProcessEnv = process.env): string {
  return env.DEVSPACE_CCUSAGE_COMMAND?.trim() || "ccusage";
}

export function parseCcusageSessionSnapshot(
  json: string,
  providerSessionId: string,
): LocalAgentUsageSnapshot | undefined {
  const document = JSON.parse(json) as unknown;
  const sessions = record(document)?.sessions;
  if (!Array.isArray(sessions)) throw new Error("ccusage output did not contain sessions[].");
  const session = sessions.map(record).find((candidate) => candidate?.sessionId === providerSessionId);
  if (!session) return undefined;
  const modelBreakdowns = session.modelBreakdowns;
  if (!Array.isArray(modelBreakdowns)) {
    throw new Error("ccusage session did not contain modelBreakdowns[].");
  }
  return {
    provider: "claude",
    providerSessionId,
    meter: CCUSAGE_METER,
    meterVersion: CCUSAGE_VERSION,
    inputTokens: requiredNumber(session, "inputTokens"),
    outputTokens: requiredNumber(session, "outputTokens"),
    cacheCreationTokens: requiredNumber(session, "cacheCreationTokens"),
    cacheReadTokens: requiredNumber(session, "cacheReadTokens"),
    totalTokens: requiredNumber(session, "totalTokens"),
    totalCost: requiredNumber(session, "totalCost"),
    modelBreakdowns: modelBreakdowns.map((value) => {
      const model = record(value);
      if (!model || typeof model.modelName !== "string") {
        throw new Error("ccusage model breakdown did not contain modelName.");
      }
      return {
        modelName: model.modelName,
        inputTokens: requiredNumber(model, "inputTokens"),
        outputTokens: requiredNumber(model, "outputTokens"),
        cacheCreationTokens: requiredNumber(model, "cacheCreationTokens"),
        cacheReadTokens: requiredNumber(model, "cacheReadTokens"),
        cost: requiredNumber(model, "cost"),
      };
    }),
  };
}

const execFileAsync = promisify(execFile);

async function defaultCcusageExecutor(command: string, args: readonly string[]): Promise<{ stdout: string }> {
  const result = await execFileAsync(command, [...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: CCUSAGE_TIMEOUT_MS,
  });
  return { stdout: result.stdout };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function requiredNumber(value: Record<string, unknown>, key: string): number {
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
    throw new Error(`ccusage field ${key} was not a non-negative number.`);
  }
  return candidate;
}

function optionalNonNegativeNumber(value: Record<string, unknown>, key: string): number | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
    throw new Error(`Codex JSONL field ${key} was not a non-negative number.`);
  }
  return candidate;
}

function directString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
