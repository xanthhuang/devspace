import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Result, type Result as BetterResult } from "better-result";
import { openDatabase, type DatabaseHandle } from "./db/client.js";
import { AgentStoreError, isProgrammerDefect } from "./local-agent-errors.js";

export type LocalAgentStatus = "starting" | "running" | "idle" | "error" | "stopped";

export interface LocalAgentRecord {
  id: string;
  workspaceId?: string;
  workspaceRoot: string;
  profileName: string;
  provider: string;
  model?: string;
  effort?: string;
  providerSessionId?: string;
  currentTurnId?: string;
  status: LocalAgentStatus;
  latestResponse?: string;
  error?: string;
  errorCode?: string;
  errorRetryable?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLocalAgentRecordInput {
  workspaceId?: string;
  workspaceRoot: string;
  profileName: string;
  provider: string;
  model?: string;
  effort?: string;
}

export interface LocalAgentWorkspaceScope {
  workspaceId?: string;
  workspaceRoot: string;
}

export interface LocalAgentListScope {
  workspaceId?: string;
  workspaceRoot?: string;
}

export type AgentEventType = "agent.settled" | "agent.failed";
export type AgentEventTerminalStatus = "idle" | "error";
export type AgentEventDeliveryState = "pending" | "delivered";

export interface AgentEventPayload {
  event_id: string;
  type: AgentEventType;
  created_at: string;
  agent_id: string;
  turn_id: string;
  workspace_id?: string;
  workspace_root: string;
  provider: string;
  provider_session_id?: string;
  terminal_status: AgentEventTerminalStatus;
}

export interface AgentEventRecord {
  eventId: string;
  transitionKey: string;
  type: AgentEventType;
  agentId: string;
  workspaceId?: string;
  workspaceRoot: string;
  provider: string;
  providerSessionId?: string;
  terminalStatus: AgentEventTerminalStatus;
  createdAt: string;
  payloadJson: string;
  payloadSha256: string;
  deliveryState: AgentEventDeliveryState;
  attempts: number;
  lastError?: string;
  deliveredAt?: string;
}

export type SettleLocalAgentInput =
  | {
      status: "idle";
      providerSessionId?: string;
      latestResponse: string;
    }
  | {
      status: "error";
      providerSessionId?: string;
      error: string;
      errorCode: string;
      errorRetryable: boolean;
    };

export interface SettleLocalAgentOptions {
  emitEvent: boolean;
  expectedTurnId: string;
}

export interface SettleLocalAgentResult {
  agent: LocalAgentRecord;
  event?: AgentEventRecord;
  created: boolean;
}

interface LocalAgentRow {
  id: string;
  workspace_id: string | null;
  workspace_root: string;
  profile_name: string;
  provider: string;
  model: string | null;
  effort: string | null;
  provider_session_id: string | null;
  current_turn_id: string | null;
  status: string;
  latest_response: string | null;
  error: string | null;
  error_code: string | null;
  error_retryable: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentEventRow {
  event_id: string;
  transition_key: string;
  type: string;
  agent_id: string;
  workspace_id: string | null;
  workspace_root: string;
  provider: string;
  provider_session_id: string | null;
  terminal_status: string;
  created_at: string;
  payload_json: string;
  payload_sha256: string;
  delivery_state: string;
  attempts: number;
  last_error: string | null;
  delivered_at: string | null;
}

export class LocalAgentStore {
  private readonly database: DatabaseHandle;

  constructor(stateDir: string) {
    this.database = openDatabase(stateDir);
  }

  list(scope: LocalAgentListScope = {}): LocalAgentRecord[] {
    let rows: LocalAgentRow[];
    if (scope.workspaceId && scope.workspaceRoot) {
      rows = this.database.sqlite
        .prepare(
          `select * from local_agent_sessions
           where workspace_id = ? and workspace_root = ?
           order by updated_at desc`,
        )
        .all(scope.workspaceId, resolve(scope.workspaceRoot)) as LocalAgentRow[];
    } else if (scope.workspaceId) {
      rows = this.database.sqlite
        .prepare(
          `select * from local_agent_sessions
           where workspace_id = ?
           order by updated_at desc`,
        )
        .all(scope.workspaceId) as LocalAgentRow[];
    } else if (scope.workspaceRoot) {
      rows = this.database.sqlite
        .prepare(
          `select * from local_agent_sessions
           where workspace_root = ?
           order by updated_at desc`,
        )
        .all(resolve(scope.workspaceRoot)) as LocalAgentRow[];
    } else {
      rows = this.database.sqlite
        .prepare("select * from local_agent_sessions order by updated_at desc")
        .all() as LocalAgentRow[];
    }

    return rows.map(rowToLocalAgentRecord);
  }

  listResult(scope: LocalAgentListScope = {}): BetterResult<LocalAgentRecord[], AgentStoreError> {
    return storeResult("list", () => this.list(scope));
  }

  create(input: CreateLocalAgentRecordInput): LocalAgentRecord {
    const now = new Date().toISOString();
    const record: LocalAgentRecord = {
      id: `agt_${randomUUID().replaceAll("-", "").slice(0, 8)}`,
      workspaceId: input.workspaceId,
      workspaceRoot: resolve(input.workspaceRoot),
      profileName: input.profileName,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      status: "starting",
      createdAt: now,
      updatedAt: now,
    };

    this.database.sqlite
      .prepare(
        `insert into local_agent_sessions (
          id,
          workspace_id,
          workspace_root,
          profile_name,
          provider,
          model,
          effort,
          status,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.workspaceId ?? null,
        record.workspaceRoot,
        record.profileName,
        record.provider,
        record.model ?? null,
        record.effort ?? null,
        record.status,
        record.createdAt,
        record.updatedAt,
      );

    return record;
  }

  createResult(input: CreateLocalAgentRecordInput): BetterResult<LocalAgentRecord, AgentStoreError> {
    return storeResult("create", () => this.create(input));
  }

  getById(id: string): LocalAgentRecord | undefined {
    const exact = this.database.sqlite
      .prepare(
        `select * from local_agent_sessions
         where id = ?
         limit 1`,
      )
      .get(id) as LocalAgentRow | undefined;
    return exact ? rowToLocalAgentRecord(exact) : undefined;
  }

  getByIdResult(id: string): BetterResult<LocalAgentRecord | undefined, AgentStoreError> {
    return storeResult("get", () => this.getById(id));
  }

  /**
   * Compatibility alias for callers that already use the store directly.
   * Identity lookup is exact and never falls back to provider session IDs.
   */
  get(id: string): LocalAgentRecord | undefined {
    return this.getById(id);
  }

  update(id: string, patch: Partial<Omit<LocalAgentRecord, "id" | "createdAt">>): LocalAgentRecord {
    const current = this.getById(id);
    if (!current) throw new Error(`Unknown subagent id: ${id}`);

    const updated: LocalAgentRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    this.database.sqlite
      .prepare(
        `update local_agent_sessions set
          workspace_id = ?,
          workspace_root = ?,
          profile_name = ?,
          provider = ?,
          model = ?,
          effort = ?,
          provider_session_id = ?,
          current_turn_id = ?,
          status = ?,
          latest_response = ?,
          error = ?,
          error_code = ?,
          error_retryable = ?,
          updated_at = ?
         where id = ?`,
      )
      .run(
        updated.workspaceId ?? null,
        resolve(updated.workspaceRoot),
        updated.profileName,
        updated.provider,
        updated.model ?? null,
        updated.effort ?? null,
        updated.providerSessionId ?? null,
        updated.currentTurnId ?? null,
        updated.status,
        updated.latestResponse ?? null,
        updated.error ?? null,
        updated.errorCode ?? null,
        updated.errorRetryable === undefined ? null : String(updated.errorRetryable),
        updated.updatedAt,
        updated.id,
      );

    return updated;
  }

  updateResult(
    id: string,
    patch: Partial<Omit<LocalAgentRecord, "id" | "createdAt">>,
  ): BetterResult<LocalAgentRecord, AgentStoreError> {
    return storeResult("update", () => this.update(id, patch));
  }

  startTurn(
    id: string,
    patch: Partial<Omit<LocalAgentRecord, "id" | "createdAt" | "currentTurnId" | "status">> = {},
  ): LocalAgentRecord {
    return this.update(id, {
      ...patch,
      currentTurnId: createTurnId(),
      status: "running",
    });
  }

  startTurnResult(
    id: string,
    patch: Partial<Omit<LocalAgentRecord, "id" | "createdAt" | "currentTurnId" | "status">> = {},
  ): BetterResult<LocalAgentRecord, AgentStoreError> {
    return storeResult("start_turn", () => this.startTurn(id, patch));
  }

  settle(
    id: string,
    input: SettleLocalAgentInput,
    options: SettleLocalAgentOptions,
  ): SettleLocalAgentResult {
    const transaction = this.database.sqlite.transaction(() => {
      const current = this.getById(id);
      if (!current) throw new Error(`Unknown subagent id: ${id}`);
      if (current.currentTurnId !== options.expectedTurnId) {
        throw new Error(`Subagent ${id} has started a newer turn.`);
      }

      const transitionKey = `${current.id}:${options.expectedTurnId}`;
      const existing = this.getEventByTransitionKey(transitionKey);
      if (existing) return { agent: current, event: existing, created: false };
      if (current.status === "idle" || current.status === "error") {
        return { agent: current, created: false };
      }

      const createdAt = new Date().toISOString();
      const providerSessionId = input.providerSessionId ?? current.providerSessionId;
      this.database.sqlite
        .prepare(
          `update local_agent_sessions set
            provider_session_id = ?, status = ?, latest_response = ?, error = ?,
            error_code = ?, error_retryable = ?, updated_at = ?
           where id = ? and current_turn_id = ?`,
        )
        .run(
          providerSessionId ?? null,
          input.status,
          input.status === "idle" ? input.latestResponse : current.latestResponse ?? null,
          input.status === "error" ? input.error : null,
          input.status === "error" ? input.errorCode : null,
          input.status === "error" ? String(input.errorRetryable) : null,
          createdAt,
          current.id,
          options.expectedTurnId,
        );

      const agent = this.getById(id);
      if (!agent) throw new Error(`Failed to persist terminal state for subagent ${id}.`);
      if (!options.emitEvent) return { agent, created: false };
      const event = this.insertTerminalEvent(
        current,
        options.expectedTurnId,
        input.status,
        providerSessionId,
        createdAt,
      );
      return { agent, event, created: true };
    });
    return transaction.immediate();
  }

  settleResult(
    id: string,
    input: SettleLocalAgentInput,
    options: SettleLocalAgentOptions,
  ): BetterResult<SettleLocalAgentResult, AgentStoreError> {
    return storeResult("settle", () => this.settle(id, input, options));
  }

  listPendingEvents(): AgentEventRecord[] {
    const rows = this.database.sqlite
      .prepare(
        `select * from agent_event_outbox
         where delivery_state = 'pending'
         order by created_at, event_id`,
      )
      .all() as AgentEventRow[];
    return rows.map(rowToAgentEventRecord);
  }

  listPendingEventsResult(): BetterResult<AgentEventRecord[], AgentStoreError> {
    return storeResult("list_pending_events", () => this.listPendingEvents());
  }

  getEvent(eventId: string): AgentEventRecord | undefined {
    const row = this.database.sqlite
      .prepare("select * from agent_event_outbox where event_id = ?")
      .get(eventId) as AgentEventRow | undefined;
    return row ? rowToAgentEventRecord(row) : undefined;
  }

  markEventDelivered(eventId: string, deliveredAt = new Date().toISOString()): void {
    this.database.sqlite
      .prepare(
        `update agent_event_outbox set
          delivery_state = 'delivered', attempts = attempts + 1,
          last_error = null, delivered_at = ?
         where event_id = ? and delivery_state = 'pending'`,
      )
      .run(deliveredAt, eventId);
  }

  markEventDeliveredResult(eventId: string): BetterResult<void, AgentStoreError> {
    return storeResult("mark_event_delivered", () => this.markEventDelivered(eventId));
  }

  recordEventDeliveryFailure(eventId: string, error: string): void {
    this.database.sqlite
      .prepare(
        `update agent_event_outbox set attempts = attempts + 1, last_error = ?
         where event_id = ? and delivery_state = 'pending'`,
      )
      .run(error, eventId);
  }

  recordEventDeliveryFailureResult(
    eventId: string,
    error: string,
  ): BetterResult<void, AgentStoreError> {
    return storeResult("record_event_delivery_failure", () => (
      this.recordEventDeliveryFailure(eventId, error)
    ));
  }

  reconcileActiveRuns(
    message = "DevSpace restarted while this agent turn was running.",
    emitEvents = false,
  ): number {
    const transaction = this.database.sqlite.transaction(() => {
      const rows = this.database.sqlite
        .prepare("select * from local_agent_sessions where status in ('starting', 'running')")
        .all() as LocalAgentRow[];
      for (const row of rows) {
        const current = rowToLocalAgentRecord(row);
        const turnId = current.currentTurnId ?? createTurnId();
        const createdAt = new Date().toISOString();
        this.database.sqlite
          .prepare(
            `update local_agent_sessions
             set current_turn_id = ?, status = 'error', error = ?, error_code = 'DAEMON_UNAVAILABLE',
                 error_retryable = 'true', updated_at = ?
             where id = ?`,
          )
          .run(turnId, message, createdAt, current.id);
        if (emitEvents && !this.getEventByTransitionKey(`${current.id}:${turnId}`)) {
          this.insertTerminalEvent(current, turnId, "error", current.providerSessionId, createdAt);
        }
      }
      return rows.length;
    });
    return transaction.immediate();
  }

  reconcileActiveRunsResult(
    message = "DevSpace restarted while this agent turn was running.",
    emitEvents = false,
  ): BetterResult<number, AgentStoreError> {
    return storeResult("reconcile_active_runs", () => this.reconcileActiveRuns(message, emitEvents));
  }

  private getEventByTransitionKey(transitionKey: string): AgentEventRecord | undefined {
    const row = this.database.sqlite
      .prepare("select * from agent_event_outbox where transition_key = ?")
      .get(transitionKey) as AgentEventRow | undefined;
    return row ? rowToAgentEventRecord(row) : undefined;
  }

  private insertTerminalEvent(
    current: LocalAgentRecord,
    turnId: string,
    terminalStatus: AgentEventTerminalStatus,
    providerSessionId: string | undefined,
    createdAt: string,
  ): AgentEventRecord {
    const eventId = createEventId();
    const type: AgentEventType = terminalStatus === "idle" ? "agent.settled" : "agent.failed";
    const payload: AgentEventPayload = {
      event_id: eventId,
      type,
      created_at: createdAt,
      agent_id: current.id,
      turn_id: turnId,
      ...(current.workspaceId ? { workspace_id: current.workspaceId } : {}),
      workspace_root: current.workspaceRoot,
      provider: current.provider,
      ...(providerSessionId ? { provider_session_id: providerSessionId } : {}),
      terminal_status: terminalStatus,
    };
    const payloadJson = JSON.stringify(payload);
    this.database.sqlite
      .prepare(
        `insert into agent_event_outbox (
          event_id, transition_key, type, agent_id, workspace_id, workspace_root,
          provider, provider_session_id, terminal_status, created_at, payload_json,
          payload_sha256, delivery_state, attempts
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
      )
      .run(
        eventId,
        `${current.id}:${turnId}`,
        type,
        current.id,
        current.workspaceId ?? null,
        current.workspaceRoot,
        current.provider,
        providerSessionId ?? null,
        terminalStatus,
        createdAt,
        payloadJson,
        createHash("sha256").update(payloadJson).digest("hex"),
      );
    const event = this.getEvent(eventId);
    if (!event) throw new Error(`Failed to persist terminal event for subagent ${current.id}.`);
    return event;
  }

  close(): void {
    this.database.close();
  }

}

export function createLocalAgentStore(stateDir: string): LocalAgentStore {
  return new LocalAgentStore(stateDir);
}

function rowToLocalAgentRecord(row: LocalAgentRow): LocalAgentRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? undefined,
    workspaceRoot: row.workspace_root,
    profileName: row.profile_name,
    provider: row.provider,
    model: row.model ?? undefined,
    effort: row.effort ?? undefined,
    providerSessionId: row.provider_session_id ?? undefined,
    currentTurnId: row.current_turn_id ?? undefined,
    status: readStatus(row.status),
    latestResponse: row.latest_response ?? undefined,
    error: row.error ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorRetryable: readOptionalBoolean(row.error_retryable),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAgentEventRecord(row: AgentEventRow): AgentEventRecord {
  return {
    eventId: row.event_id,
    transitionKey: row.transition_key,
    type: readEventType(row.type),
    agentId: row.agent_id,
    workspaceId: row.workspace_id ?? undefined,
    workspaceRoot: row.workspace_root,
    provider: row.provider,
    providerSessionId: row.provider_session_id ?? undefined,
    terminalStatus: readTerminalStatus(row.terminal_status),
    createdAt: row.created_at,
    payloadJson: row.payload_json,
    payloadSha256: row.payload_sha256,
    deliveryState: readDeliveryState(row.delivery_state),
    attempts: row.attempts,
    lastError: row.last_error ?? undefined,
    deliveredAt: row.delivered_at ?? undefined,
  };
}

function readEventType(type: string): AgentEventType {
  if (type === "agent.settled" || type === "agent.failed") return type;
  throw new Error(`Unknown agent event type: ${type}`);
}

function readTerminalStatus(status: string): AgentEventTerminalStatus {
  if (status === "idle" || status === "error") return status;
  throw new Error(`Unknown agent event terminal status: ${status}`);
}

function readDeliveryState(state: string): AgentEventDeliveryState {
  if (state === "pending" || state === "delivered") return state;
  throw new Error(`Unknown agent event delivery state: ${state}`);
}

function readOptionalBoolean(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function storeResult<T>(operation: string, run: () => T): BetterResult<T, AgentStoreError> {
  try {
    return Result.ok(run());
  } catch (cause) {
    if (isProgrammerDefect(cause)) throw cause;
    return Result.err(new AgentStoreError(operation, cause));
  }
}

function readStatus(status: string): LocalAgentStatus {
  if (
    status === "starting" ||
    status === "running" ||
    status === "idle" ||
    status === "error" ||
    status === "stopped"
  ) {
    return status;
  }
  return "error";
}

function createTurnId(): string {
  return `turn_${randomUUID()}`;
}

function createEventId(): string {
  return `evt_${randomUUID()}`;
}
