import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Result, type Result as BetterResult } from "better-result";
import { openDatabase, type DatabaseHandle } from "./db/client.js";
import { AgentStoreError, isProgrammerDefect } from "./local-agent-errors.js";
import type {
  LocalAgentUsageModelSnapshot,
  LocalAgentUsageSnapshot,
} from "./local-agent-metering.js";

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

interface LocalAgentUsageMeteringRow {
  agent_id: string;
  turn_id: string;
  workspace_id: string | null;
  workspace_root: string;
  profile_name: string;
  provider: string;
  model: string | null;
  effort: string | null;
  provider_session_id: string | null;
  meter: string;
  meter_version: string;
  complete: string;
  snapshot_input_tokens: number;
  snapshot_output_tokens: number;
  snapshot_cache_creation_tokens: number;
  snapshot_cache_read_tokens: number;
  snapshot_total_tokens: number;
  snapshot_total_cost: number;
  snapshot_models_json: string;
  delta_input_tokens: number;
  delta_output_tokens: number;
  delta_cache_creation_tokens: number;
  delta_cache_read_tokens: number;
  delta_total_tokens: number;
  delta_total_cost: number;
  delta_models_json: string;
  recorded_at: string;
}

export interface LocalAgentUsageSummaryGroup {
  name: string;
  runs: number;
  totalCost: number;
}

export interface LocalAgentUsageModelSummary extends LocalAgentUsageSummaryGroup {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface LocalAgentUsageRunSummary {
  agentId: string;
  turnId: string;
  recordedAt: string;
  profileName: string;
  model?: string;
  effort?: string;
  meter: string;
  meterVersion: string;
  complete: boolean;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  models: LocalAgentUsageModelSnapshot[];
}

export interface LocalAgentUsageSummary {
  provider: string;
  days: number;
  since: string;
  through: string;
  runs: number;
  completeRuns: number;
  incompleteRuns: number;
  meters: string[];
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  byProfile: LocalAgentUsageSummaryGroup[];
  byModel: LocalAgentUsageModelSummary[];
  recentRuns: LocalAgentUsageRunSummary[];
}

export interface LocalAgentUsageSummaryOptions {
  provider?: string;
  days?: number;
  now?: Date;
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

  recordUsageSnapshot(
    agentId: string,
    turnId: string,
    snapshot: LocalAgentUsageSnapshot,
    newProviderSession: boolean,
    recordedAt = new Date().toISOString(),
  ): void {
    const transaction = this.database.sqlite.transaction(() => {
    const agent = this.getById(agentId);
    if (!agent) throw new Error(`Unknown subagent id: ${agentId}`);
    if (agent.provider !== snapshot.provider) {
      throw new Error(`Usage provider ${snapshot.provider} does not match agent provider ${agent.provider}.`);
    }
    if (agent.providerSessionId !== snapshot.providerSessionId) {
      throw new Error("Usage snapshot does not match the agent provider session.");
    }
    const previous = this.database.sqlite
      .prepare(
        `select * from local_agent_usage_metering
         where provider = ? and provider_session_id = ?
         order by recorded_at desc, rowid desc limit 1`,
      )
      .get(snapshot.provider, snapshot.providerSessionId) as LocalAgentUsageMeteringRow | undefined;
    const previousSnapshot = previous ? rowToUsageSnapshot(previous) : undefined;
    const complete = newProviderSession || Boolean(
      previousSnapshot
      && previousSnapshot.meter === snapshot.meter
      && previousSnapshot.meterVersion === snapshot.meterVersion
      && !usageRegressed(snapshot, previousSnapshot),
    );
    const delta = complete
      ? subtractUsage(snapshot, newProviderSession ? undefined : previousSnapshot)
      : zeroUsage(snapshot);
    this.database.sqlite
      .prepare(
        `insert into local_agent_usage_metering (
          agent_id, turn_id, workspace_id, workspace_root, profile_name, provider,
          model, effort, provider_session_id, meter, meter_version, complete,
          snapshot_input_tokens, snapshot_output_tokens, snapshot_cache_creation_tokens,
          snapshot_cache_read_tokens, snapshot_total_tokens, snapshot_total_cost,
          snapshot_models_json, delta_input_tokens, delta_output_tokens,
          delta_cache_creation_tokens, delta_cache_read_tokens, delta_total_tokens,
          delta_total_cost, delta_models_json, recorded_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(agent_id, turn_id) do nothing`,
      )
      .run(
        agent.id,
        turnId,
        agent.workspaceId ?? null,
        agent.workspaceRoot,
        agent.profileName,
        snapshot.provider,
        agent.model ?? null,
        agent.effort ?? null,
        snapshot.providerSessionId,
        snapshot.meter,
        snapshot.meterVersion,
        String(complete),
        snapshot.inputTokens,
        snapshot.outputTokens,
        snapshot.cacheCreationTokens,
        snapshot.cacheReadTokens,
        snapshot.totalTokens,
        snapshot.totalCost,
        JSON.stringify(snapshot.modelBreakdowns),
        delta.inputTokens,
        delta.outputTokens,
        delta.cacheCreationTokens,
        delta.cacheReadTokens,
        delta.totalTokens,
        delta.totalCost,
        JSON.stringify(delta.modelBreakdowns),
        recordedAt,
      );
    });
    transaction.immediate();
  }

  recordUsageSnapshotResult(
    agentId: string,
    turnId: string,
    snapshot: LocalAgentUsageSnapshot,
    newProviderSession: boolean,
  ): BetterResult<void, AgentStoreError> {
    return storeResult("record_usage_snapshot", () => (
      this.recordUsageSnapshot(agentId, turnId, snapshot, newProviderSession)
    ));
  }

  usageSummary(options: LocalAgentUsageSummaryOptions = {}): LocalAgentUsageSummary {
    const provider = options.provider ?? "claude";
    const days = options.days ?? 30;
    if (!Number.isInteger(days) || days <= 0) {
      throw new Error("Usage summary days must be a positive integer.");
    }
    const now = options.now ?? new Date();
    const through = now.toISOString();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.database.sqlite
      .prepare(
        `select * from local_agent_usage_metering
         where provider = ? and recorded_at >= ? and recorded_at <= ?
         order by recorded_at`,
      )
      .all(provider, since, through) as LocalAgentUsageMeteringRow[];

    const meters = new Set<string>();
    const profileGroups = new Map<string, LocalAgentUsageSummaryGroup>();
    const modelGroups = new Map<string, LocalAgentUsageModelSummary>();
    let completeRuns = 0;
    let totalCost = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let totalTokens = 0;

    for (const row of rows) {
      if (row.complete === "true") completeRuns += 1;
      meters.add(`${row.meter}@${row.meter_version}`);
      totalCost += row.delta_total_cost;
      inputTokens += row.delta_input_tokens;
      outputTokens += row.delta_output_tokens;
      cacheReadTokens += row.delta_cache_read_tokens;
      cacheCreationTokens += row.delta_cache_creation_tokens;
      totalTokens += row.delta_total_tokens;

      const profile = profileGroups.get(row.profile_name) ?? {
        name: row.profile_name,
        runs: 0,
        totalCost: 0,
      };
      profile.runs += 1;
      profile.totalCost += row.delta_total_cost;
      profileGroups.set(row.profile_name, profile);

      for (const model of parseUsageModels(row.delta_models_json)) {
        if (
          model.inputTokens === 0
          && model.outputTokens === 0
          && model.cacheReadTokens === 0
          && model.cacheCreationTokens === 0
          && model.cost === 0
        ) continue;
        const group = modelGroups.get(model.modelName) ?? {
          name: model.modelName,
          runs: 0,
          totalCost: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        };
        group.runs += 1;
        group.totalCost += model.cost;
        group.inputTokens += model.inputTokens;
        group.outputTokens += model.outputTokens;
        group.cacheReadTokens += model.cacheReadTokens;
        group.cacheCreationTokens += model.cacheCreationTokens;
        modelGroups.set(model.modelName, group);
      }
    }

    return {
      provider,
      days,
      since,
      through,
      runs: rows.length,
      completeRuns,
      incompleteRuns: rows.length - completeRuns,
      meters: Array.from(meters).sort(),
      totalCost,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens,
      byProfile: Array.from(profileGroups.values()).sort(
        (a, b) => b.totalCost - a.totalCost || a.name.localeCompare(b.name),
      ),
      byModel: Array.from(modelGroups.values()).sort(
        (a, b) => b.totalCost - a.totalCost || a.name.localeCompare(b.name),
      ),
      recentRuns: rows
        .map((row): LocalAgentUsageRunSummary => ({
          agentId: row.agent_id,
          turnId: row.turn_id,
          recordedAt: row.recorded_at,
          profileName: row.profile_name,
          model: row.model ?? undefined,
          effort: row.effort ?? undefined,
          meter: row.meter,
          meterVersion: row.meter_version,
          complete: row.complete === "true",
          totalCost: row.delta_total_cost,
          inputTokens: row.delta_input_tokens,
          outputTokens: row.delta_output_tokens,
          cacheReadTokens: row.delta_cache_read_tokens,
          cacheCreationTokens: row.delta_cache_creation_tokens,
          totalTokens: row.delta_total_tokens,
          models: parseUsageModels(row.delta_models_json),
        }))
        .reverse(),
    };
  }

  usageSummaryResult(
    options: LocalAgentUsageSummaryOptions = {},
  ): BetterResult<LocalAgentUsageSummary, AgentStoreError> {
    return storeResult("usage_summary", () => this.usageSummary(options));
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

function parseUsageModels(value: string): LocalAgentUsageModelSnapshot[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is LocalAgentUsageModelSnapshot => (
          entry !== null
          && typeof entry === "object"
          && typeof (entry as { modelName?: unknown }).modelName === "string"
        ))
      : [];
  } catch {
    return [];
  }
}

function rowToUsageSnapshot(row: LocalAgentUsageMeteringRow): LocalAgentUsageSnapshot {
  return {
    provider: row.provider as LocalAgentUsageSnapshot["provider"],
    providerSessionId: row.provider_session_id ?? "",
    meter: row.meter,
    meterVersion: row.meter_version,
    inputTokens: row.snapshot_input_tokens,
    outputTokens: row.snapshot_output_tokens,
    cacheCreationTokens: row.snapshot_cache_creation_tokens,
    cacheReadTokens: row.snapshot_cache_read_tokens,
    totalTokens: row.snapshot_total_tokens,
    totalCost: row.snapshot_total_cost,
    modelBreakdowns: parseUsageModels(row.snapshot_models_json),
  };
}

function usageRegressed(current: LocalAgentUsageSnapshot, previous: LocalAgentUsageSnapshot): boolean {
  if (
    current.inputTokens < previous.inputTokens
    || current.outputTokens < previous.outputTokens
    || current.cacheCreationTokens < previous.cacheCreationTokens
    || current.cacheReadTokens < previous.cacheReadTokens
    || current.totalTokens < previous.totalTokens
    || current.totalCost < previous.totalCost
  ) return true;
  const previousModels = new Map(previous.modelBreakdowns.map((model) => [model.modelName, model]));
  const currentModels = new Map(current.modelBreakdowns.map((model) => [model.modelName, model]));
  if (Array.from(previousModels.keys()).some((modelName) => !currentModels.has(modelName))) {
    return true;
  }
  return current.modelBreakdowns.some((model) => {
    const prior = previousModels.get(model.modelName);
    return Boolean(prior && (
      model.inputTokens < prior.inputTokens
      || model.outputTokens < prior.outputTokens
      || model.cacheCreationTokens < prior.cacheCreationTokens
      || model.cacheReadTokens < prior.cacheReadTokens
      || model.cost < prior.cost
    ));
  });
}

function subtractUsage(
  current: LocalAgentUsageSnapshot,
  previous?: LocalAgentUsageSnapshot,
): LocalAgentUsageSnapshot {
  const previousModels = new Map(previous?.modelBreakdowns.map((model) => [model.modelName, model]) ?? []);
  return {
    ...current,
    inputTokens: current.inputTokens - (previous?.inputTokens ?? 0),
    outputTokens: current.outputTokens - (previous?.outputTokens ?? 0),
    cacheCreationTokens: current.cacheCreationTokens - (previous?.cacheCreationTokens ?? 0),
    cacheReadTokens: current.cacheReadTokens - (previous?.cacheReadTokens ?? 0),
    totalTokens: current.totalTokens - (previous?.totalTokens ?? 0),
    totalCost: current.totalCost - (previous?.totalCost ?? 0),
    modelBreakdowns: current.modelBreakdowns.map((model) => {
      const prior = previousModels.get(model.modelName);
      return {
        ...model,
        inputTokens: model.inputTokens - (prior?.inputTokens ?? 0),
        outputTokens: model.outputTokens - (prior?.outputTokens ?? 0),
        cacheCreationTokens: model.cacheCreationTokens - (prior?.cacheCreationTokens ?? 0),
        cacheReadTokens: model.cacheReadTokens - (prior?.cacheReadTokens ?? 0),
        cost: model.cost - (prior?.cost ?? 0),
      };
    }),
  };
}

function zeroUsage(snapshot: LocalAgentUsageSnapshot): LocalAgentUsageSnapshot {
  return {
    ...snapshot,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    modelBreakdowns: [],
  };
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
