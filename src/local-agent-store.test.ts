import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { databasePath } from "./db/client.js";
import { LocalAgentStore } from "./local-agent-store.js";
import { createHash } from "node:crypto";

const root = mkdtempSync(join(tmpdir(), "devspace-local-agent-store-test-"));
const stores: LocalAgentStore[] = [];

try {
  const store = new LocalAgentStore(root);
  stores.push(store);
  const created = store.create({
    workspaceId: "ws_1",
    workspaceRoot: join(root, "project"),
    profileName: "reviewer",
    provider: "codex",
    model: "gpt-5.4",
    effort: "high",
  });

  assert.match(created.id, /^agt_[a-f0-9]{8}$/);
  assert.equal(created.status, "starting");
  assert.equal(store.getById(created.id)?.effort, "high");
  assert.equal(store.getById(created.id)?.profileName, "reviewer");
  assert.equal(store.getById(created.id.slice(0, 7)), undefined);

  const updated = store.update(created.id, {
    status: "error",
    latestResponse: "done",
    providerSessionId: "thread_123",
    effort: "medium",
    error: "Codex executable was not found.",
    errorCode: "PROVIDER_UNAVAILABLE",
    errorRetryable: false,
  });

  assert.equal(updated.status, "error");
  assert.equal(updated.effort, "medium");
  assert.equal(updated.errorCode, "PROVIDER_UNAVAILABLE");
  assert.equal(updated.errorRetryable, false);
  assert.equal(store.getById("thread_123"), undefined);
  const storedError = store.getById(created.id);
  assert.equal(storedError?.error, "Codex executable was not found.");
  assert.equal(storedError?.errorCode, "PROVIDER_UNAVAILABLE");
  assert.equal(storedError?.errorRetryable, false);
  assert.equal(store.update(created.id, { latestResponse: undefined }).latestResponse, undefined);
  assert.deepEqual(
    store.list({ workspaceRoot: join(root, "project") }).map((agent) => agent.latestResponse),
    [undefined],
  );
assert.deepEqual(store.list({ workspaceId: "ws_1" }).map((agent) => agent.id), [created.id]);
assert.deepEqual(store.list({ workspaceId: "ws_other" }), []);
assert.deepEqual(store.list({ workspaceId: "ws_1", workspaceRoot: join(root, "other") }), []);
assert.deepEqual(store.list({ workspaceRoot: join(root, "other") }), []);

  const otherStore = new LocalAgentStore(root);
  stores.push(otherStore);
  const createdFromOtherStore = otherStore.create({
    workspaceId: "ws_1",
    workspaceRoot: join(root, "project"),
    profileName: "explorer",
    provider: "claude",
  });

  assert.deepEqual(
    store.list({ workspaceId: "ws_1" }).map((agent) => agent.id).sort(),
    [created.id, createdFromOtherStore.id].sort(),
  );

  const callbackAgent = store.create({
    workspaceId: "ws_callback",
    workspaceRoot: join(root, "project"),
    profileName: "worker",
    provider: "codex",
    effort: "xhigh",
  });
  const callbackTurn = store.startTurn(callbackAgent.id);
  assert.match(callbackTurn.currentTurnId ?? "", /^turn_[0-9a-f-]{36}$/);
  const settled = store.settle(callbackAgent.id, {
    status: "idle",
    providerSessionId: "provider-session-callback",
    latestResponse: "private response must remain in the agent record",
  }, {
    emitEvent: true,
    expectedTurnId: callbackTurn.currentTurnId!,
  });
  assert.equal(settled.agent.status, "idle");
  assert.equal(settled.agent.effort, "xhigh");
  assert.equal(settled.created, true);
  assert.ok(settled.event);
  assert.equal(settled.event.agentId, callbackAgent.id);
  assert.equal(settled.event.workspaceId, "ws_callback");
  assert.equal(settled.event.terminalStatus, "idle");
  assert.equal(
    settled.event.payloadSha256,
    createHash("sha256").update(settled.event.payloadJson).digest("hex"),
  );
  assert.doesNotMatch(settled.event.payloadJson, /private response|xhigh/);
  assert.deepEqual(Object.keys(JSON.parse(settled.event.payloadJson)).sort(), [
    "agent_id",
    "created_at",
    "event_id",
    "provider",
    "provider_session_id",
    "terminal_status",
    "turn_id",
    "type",
    "workspace_id",
    "workspace_root",
  ]);

  const duplicateSettlement = store.settle(callbackAgent.id, {
    status: "idle",
    latestResponse: "must not replace the committed response",
  }, {
    emitEvent: true,
    expectedTurnId: callbackTurn.currentTurnId!,
  });
  assert.equal(duplicateSettlement.created, false);
  assert.equal(duplicateSettlement.event?.eventId, settled.event.eventId);
  assert.equal(store.getById(callbackAgent.id)?.latestResponse, "private response must remain in the agent record");

  const failedTurn = store.startTurn(callbackAgent.id, { effort: "high" });
  const failedSettlement = store.settle(callbackAgent.id, {
    status: "error",
    error: "private provider error must remain in the agent record",
    errorCode: "PROVIDER_EXECUTION_ERROR",
    errorRetryable: false,
  }, {
    emitEvent: true,
    expectedTurnId: failedTurn.currentTurnId!,
  });
  assert.equal(failedSettlement.agent.errorCode, "PROVIDER_EXECUTION_ERROR");
  assert.equal(failedSettlement.agent.errorRetryable, false);
  assert.doesNotMatch(failedSettlement.event?.payloadJson ?? "", /private provider error|PROVIDER_EXECUTION_ERROR/);
  assert.equal(store.listPendingEvents().length, 2);

  const atomicAgent = store.create({
    workspaceRoot: join(root, "project"),
    profileName: "atomic",
    provider: "codex",
  });
  const atomicTurn = store.startTurn(atomicAgent.id);
  const triggerDatabase = new Database(databasePath(root));
  triggerDatabase.exec(`
    create trigger reject_atomic_terminal_event
    before insert on agent_event_outbox
    when new.agent_id = '${atomicAgent.id}'
    begin
      select raise(abort, 'forced outbox failure');
    end;
  `);
  assert.throws(() => store.settle(atomicAgent.id, {
    status: "idle",
    latestResponse: "would otherwise settle",
  }, {
    emitEvent: true,
    expectedTurnId: atomicTurn.currentTurnId!,
  }), /forced outbox failure/);
  triggerDatabase.exec("drop trigger reject_atomic_terminal_event");
  triggerDatabase.close();
  assert.equal(store.getById(atomicAgent.id)?.status, "running");
  assert.equal(store.listPendingEvents().filter((event) => event.agentId === atomicAgent.id).length, 0);

  const reconciledAgent = store.create({
    workspaceId: "ws_reconcile",
    workspaceRoot: join(root, "project"),
    profileName: "reconcile",
    provider: "claude",
  });
  const reconciledTurn = store.startTurn(reconciledAgent.id);
  assert.equal(store.reconcileActiveRuns("daemon stopped", true), 3);
  const reconciledEvent = store.listPendingEvents().find((event) => event.agentId === reconciledAgent.id);
  assert.equal(reconciledEvent?.transitionKey, `${reconciledAgent.id}:${reconciledTurn.currentTurnId}`);
  assert.equal(reconciledEvent?.terminalStatus, "error");
  assert.doesNotMatch(reconciledEvent?.payloadJson ?? "", /daemon stopped/);

  const legacyStateDir = join(root, "legacy-state");
  mkdirSync(legacyStateDir, { recursive: true });
  const legacy = new Database(databasePath(legacyStateDir));
  legacy.exec(`
    create table devspace_schema_migrations (
      version integer primary key,
      name text not null,
      applied_at text not null
    );
    create table local_agent_sessions (
      id text primary key,
      workspace_id text,
      workspace_root text not null,
      profile_name text not null,
      provider text not null,
      model text,
      thinking text,
      provider_session_id text,
      status text not null,
      latest_response text,
      error text,
      created_at text not null,
      updated_at text not null
    );
  `);
  const migration = legacy.prepare(
    "insert into devspace_schema_migrations (version, name, applied_at) values (?, ?, ?)",
  );
  // Leave migration 3 unapplied to exercise an interrupted legacy upgrade:
  // it adds an empty effort column before migration 6 copies thinking values.
  for (const [version, name] of [[1, "workspace-state"], [2, "oauth-state"], [4, "workspace-conversation-bindings"]] as const) {
    migration.run(version, name, "2026-08-01T00:00:00.000Z");
  }
  legacy.prepare(`
    insert into local_agent_sessions (
      id, workspace_root, profile_name, provider, thinking, status, error, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "agt_legacy",
    join(root, "legacy-project"),
    "reviewer",
    "codex",
    "high",
    "error",
    "old error",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
  );
  legacy.close();

  const upgradedStore = new LocalAgentStore(legacyStateDir);
  stores.push(upgradedStore);
  const legacyRecord = upgradedStore.getById("agt_legacy");
  assert.equal(legacyRecord?.error, "old error");
  assert.equal(legacyRecord?.effort, "high");
  assert.equal(legacyRecord?.errorCode, undefined);
  assert.equal(legacyRecord?.errorRetryable, undefined);
  const upgradedRecord = upgradedStore.update("agt_legacy", {
    errorCode: "DAEMON_TIMEOUT",
    errorRetryable: true,
  });
  assert.equal(upgradedRecord.errorCode, "DAEMON_TIMEOUT");
  assert.equal(upgradedRecord.errorRetryable, true);
  const reloadedRecord = upgradedStore.getById("agt_legacy");
  assert.equal(reloadedRecord?.error, "old error");
  assert.equal(reloadedRecord?.errorCode, "DAEMON_TIMEOUT");
  assert.equal(reloadedRecord?.errorRetryable, true);
  const migratedDatabase = new Database(databasePath(legacyStateDir), { readonly: true });
  const schemaVersion = migratedDatabase
    .prepare("select max(version) as version from devspace_schema_migrations")
    .get() as { version: number };
  migratedDatabase.close();
  assert.ok(schemaVersion.version >= 8);

  const collisionStateDir = join(root, "legacy-v5-collision-state");
  mkdirSync(collisionStateDir, { recursive: true });
  const collision = new Database(databasePath(collisionStateDir));
  collision.exec(`
    create table devspace_schema_migrations (
      version integer primary key,
      name text not null,
      applied_at text not null
    );
    create table local_agent_sessions (
      id text primary key,
      workspace_id text,
      workspace_root text not null,
      profile_name text not null,
      provider text not null,
      model text,
      effort text,
      provider_session_id text,
      status text not null,
      latest_response text,
      error text,
      created_at text not null,
      updated_at text not null,
      current_turn_id text
    );
    create table agent_event_outbox (
      event_id text primary key,
      transition_key text not null,
      type text not null,
      agent_id text not null,
      workspace_id text,
      workspace_root text not null,
      provider text not null,
      provider_session_id text,
      terminal_status text not null,
      created_at text not null,
      payload_json text not null,
      payload_sha256 text not null,
      delivery_state text not null default 'pending',
      attempts integer not null default 0,
      last_error text,
      delivered_at text
    );
    create unique index agent_event_outbox_transition_key_idx
      on agent_event_outbox(transition_key);
    create index agent_event_outbox_delivery_idx
      on agent_event_outbox(delivery_state, created_at);
    create index agent_event_outbox_agent_idx
      on agent_event_outbox(agent_id, created_at);
  `);
  const collisionMigration = collision.prepare(
    "insert into devspace_schema_migrations (version, name, applied_at) values (?, ?, ?)",
  );
  for (const [version, name] of [
    [1, "workspace-state"],
    [2, "oauth-state"],
    [3, "local-agent-sessions"],
    [4, "workspace-conversation-bindings"],
    [5, "agent-event-outbox"],
    [6, "local-agent-effort-rename"],
    [7, "local-agent-terminal-event-outbox"],
  ] as const) {
    collisionMigration.run(version, name, "2026-08-24T00:00:00.000Z");
  }
  collision.prepare(`
    insert into local_agent_sessions (
      id, workspace_root, profile_name, provider, status, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "agt_collision",
    join(root, "collision-project"),
    "reviewer",
    "codex",
    "idle",
    "2026-08-24T00:00:00.000Z",
    "2026-08-24T00:00:00.000Z",
  );
  collision.close();

  const repairedCollisionStore = new LocalAgentStore(collisionStateDir);
  stores.push(repairedCollisionStore);
  const repairedCollision = repairedCollisionStore.update("agt_collision", {
    errorCode: "DAEMON_TIMEOUT",
    errorRetryable: true,
  });
  assert.equal(repairedCollision.errorCode, "DAEMON_TIMEOUT");
  assert.equal(repairedCollision.errorRetryable, true);
  const collisionDatabase = new Database(databasePath(collisionStateDir), { readonly: true });
  const collisionColumns = new Set(
    (collisionDatabase.prepare("pragma table_info(local_agent_sessions)").all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  const collisionMigration8 = collisionDatabase
    .prepare("select name from devspace_schema_migrations where version = 8")
    .get() as { name: string } | undefined;
  collisionDatabase.close();
  assert.equal(collisionColumns.has("error_code"), true);
  assert.equal(collisionColumns.has("error_retryable"), true);
  assert.equal(collisionMigration8?.name, "legacy-local-agent-schema-repair");
} finally {
  for (const store of stores) {
    store.close();
  }
  rmSync(root, { recursive: true, force: true });
}
