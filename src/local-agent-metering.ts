import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LocalAgentProvider } from "./local-agent-profiles.js";

export const CCUSAGE_METER = "ccusage";
export const CCUSAGE_VERSION = "20.0.24";
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
            throw new Error(
              `ccusage version mismatch: expected ${CCUSAGE_VERSION}, got ${version}.`,
            );
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

export function resolveCcusageCommand(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DEVSPACE_CCUSAGE_COMMAND?.trim();
  if (configured) return configured;
  return "ccusage";
}

export function parseCcusageSessionSnapshot(
  json: string,
  providerSessionId: string,
): LocalAgentUsageSnapshot | undefined {
  const document = JSON.parse(json) as unknown;
  const sessions = record(document)?.sessions;
  if (!Array.isArray(sessions)) throw new Error("ccusage output did not contain sessions[].");
  const session = sessions
    .map(record)
    .find((candidate) => candidate?.sessionId === providerSessionId);
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
