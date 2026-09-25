import type { AgentStoreError } from "./local-agent-errors.js";
import { LocalAgentStore, type AgentEventRecord } from "./local-agent-store.js";

const DEFAULT_CALLBACK_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_INTERVAL_MS = 5_000;
const MAX_CALLBACK_TIMEOUT_MS = 60_000;
const MAX_PERSISTED_ERROR_LENGTH = 500;

export const AGENT_CALLBACK_ENV_NAMES = [
  "DEVSPACE_AGENT_CALLBACK_URL",
  "DEVSPACE_AGENT_CALLBACK_TOKEN",
  "DEVSPACE_AGENT_CALLBACK_TIMEOUT_MS",
] as const;

export interface AgentCallbackConfig {
  url?: string;
  token?: string;
  timeoutMs: number;
}

export interface AgentEventDeliveryResult {
  eventId: string;
  outcome: "disabled" | "delivered" | "pending";
  error?: string;
}

export interface AgentEventDrainResult {
  enabled: boolean;
  pending: number;
  attempted: number;
  delivered: number;
  failed: number;
}

export type AgentEventDispatcherLogger = (
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown>,
) => void;

export function loadAgentCallbackConfig(env: NodeJS.ProcessEnv = process.env): AgentCallbackConfig {
  return {
    url: parseCallbackUrl(env.DEVSPACE_AGENT_CALLBACK_URL),
    token: parseCallbackToken(env.DEVSPACE_AGENT_CALLBACK_TOKEN),
    timeoutMs: parsePositiveInteger(
      env.DEVSPACE_AGENT_CALLBACK_TIMEOUT_MS,
      DEFAULT_CALLBACK_TIMEOUT_MS,
      "DEVSPACE_AGENT_CALLBACK_TIMEOUT_MS",
      MAX_CALLBACK_TIMEOUT_MS,
    ),
  };
}

export function clearAgentCallbackEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of AGENT_CALLBACK_ENV_NAMES) delete env[name];
}

export async function deliverAgentEvent(
  store: LocalAgentStore,
  event: AgentEventRecord,
  config: AgentCallbackConfig,
  fetchImplementation: typeof fetch = fetch,
): Promise<AgentEventDeliveryResult> {
  if (!config.url) return { eventId: event.eventId, outcome: "disabled" };
  try {
    const response = await fetchImplementation(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      },
      body: event.payloadJson,
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    await response.body?.cancel();
    if (response.status >= 200 && response.status < 300) {
      unwrapStoreResult(store.markEventDeliveredResult(event.eventId));
      return { eventId: event.eventId, outcome: "delivered" };
    }
    return persistFailure(store, event.eventId, `HTTP ${response.status}`);
  } catch (error) {
    if (isAgentStoreError(error)) throw error;
    return persistFailure(store, event.eventId, callbackErrorMessage(error, config.timeoutMs));
  }
}

export async function drainPendingAgentEvents(
  store: LocalAgentStore,
  config: AgentCallbackConfig,
  fetchImplementation: typeof fetch = fetch,
): Promise<AgentEventDrainResult> {
  const events = unwrapStoreResult(store.listPendingEventsResult());
  if (!config.url) {
    return { enabled: false, pending: events.length, attempted: 0, delivered: 0, failed: 0 };
  }
  let delivered = 0;
  let failed = 0;
  for (const event of events) {
    const result = await deliverAgentEvent(store, event, config, fetchImplementation);
    if (result.outcome === "delivered") delivered += 1;
    else if (result.outcome === "pending") failed += 1;
  }
  return { enabled: true, pending: events.length, attempted: events.length, delivered, failed };
}

export async function drainConfiguredAgentEvents(
  stateDir: string,
  config = loadAgentCallbackConfig(),
): Promise<AgentEventDrainResult> {
  const store = new LocalAgentStore(stateDir);
  try {
    return await drainPendingAgentEvents(store, config);
  } finally {
    store.close();
  }
}

export class AgentEventDispatcher {
  private readonly store: LocalAgentStore;
  private readonly config: AgentCallbackConfig;
  private readonly logger?: AgentEventDispatcherLogger;
  private readonly fetchImplementation: typeof fetch;
  private readonly retryIntervalMs: number;
  private timer?: NodeJS.Timeout;
  private drainPromise?: Promise<AgentEventDrainResult>;
  private closed = false;

  constructor(options: {
    stateDir: string;
    config: AgentCallbackConfig;
    logger?: AgentEventDispatcherLogger;
    fetchImplementation?: typeof fetch;
    retryIntervalMs?: number;
  }) {
    this.store = new LocalAgentStore(options.stateDir);
    this.config = options.config;
    this.logger = options.logger;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  }

  start(): Promise<AgentEventDrainResult> {
    if (!this.timer && this.config.url) {
      this.timer = setInterval(() => { void this.trigger(); }, this.retryIntervalMs);
      this.timer.unref();
    }
    return this.trigger();
  }

  trigger(): Promise<AgentEventDrainResult> {
    if (this.closed) return Promise.reject(new Error("Agent event dispatcher is closed."));
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = drainPendingAgentEvents(
      this.store,
      this.config,
      this.fetchImplementation,
    ).then((result) => {
      if (result.attempted > 0) {
        this.logger?.(
          result.failed > 0 ? "warn" : "info",
          "agent_event_drain_completed",
          { ...result },
        );
      }
      return result;
    }).catch((error) => {
      this.logger?.("warn", "agent_event_drain_failed", { error: errorMessage(error) });
      throw error;
    }).finally(() => {
      this.drainPromise = undefined;
    });
    void this.drainPromise.catch(() => undefined);
    return this.drainPromise;
  }

  hasPendingEvents(): boolean {
    const result = this.store.listPendingEventsResult();
    return result.isErr() || result.value.length > 0;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.drainPromise?.catch(() => undefined);
    this.store.close();
  }
}

function persistFailure(store: LocalAgentStore, eventId: string, error: string): AgentEventDeliveryResult {
  const message = error.length <= MAX_PERSISTED_ERROR_LENGTH
    ? error
    : `${error.slice(0, MAX_PERSISTED_ERROR_LENGTH - 3)}...`;
  unwrapStoreResult(store.recordEventDeliveryFailureResult(eventId, message));
  return { eventId, outcome: "pending", error: message };
}

function parseCallbackUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid DEVSPACE_AGENT_CALLBACK_URL protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("DEVSPACE_AGENT_CALLBACK_URL must not contain credentials.");
  }
  parsed.hash = "";
  return parsed.toString();
}

function parseCallbackToken(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (/\r|\n/.test(value)) throw new Error("DEVSPACE_AGENT_CALLBACK_TOKEN must not contain newlines.");
  return value;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  max: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function callbackErrorMessage(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === "TimeoutError") return `Request timed out after ${timeoutMs}ms`;
  if (error instanceof Error && error.name === "AbortError") return `Request aborted after ${timeoutMs}ms`;
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function unwrapStoreResult<T>(result: import("better-result").Result<T, AgentStoreError>): T {
  if (result.isErr()) throw result.error;
  return result.value;
}

function isAgentStoreError(error: unknown): error is AgentStoreError {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "AGENT_STORE_ERROR");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
