import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODEX_JSONL_METER,
  CCUSAGE_VERSION,
  CcusageMeter,
  CodexJsonlMeter,
  LocalAgentUsageMeterChain,
  parseCodexSessionSnapshot,
  parseCcusageSessionSnapshot,
  resolveCcusageCommand,
  resolveCodexSessionsRoot,
} from "./local-agent-metering.js";
import { LocalAgentStore } from "./local-agent-store.js";

const json = JSON.stringify({ sessions: [{
  sessionId: "session-1",
  inputTokens: 10,
  outputTokens: 20,
  cacheCreationTokens: 30,
  cacheReadTokens: 40,
  totalTokens: 100,
  totalCost: 0.5,
  modelBreakdowns: [{
    modelName: "claude-sonnet",
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationTokens: 30,
    cacheReadTokens: 40,
    cost: 0.5,
  }],
}] });
assert.equal(parseCcusageSessionSnapshot(json, "missing"), undefined);
assert.equal(parseCcusageSessionSnapshot(json, "session-1")?.totalCost, 0.5);
assert.equal(resolveCcusageCommand({ DEVSPACE_CCUSAGE_COMMAND: "/opt/ccusage" }), "/opt/ccusage");

const calls: string[][] = [];
const meter = new CcusageMeter({ execute: async (_command, args) => {
  calls.push([...args]);
  return { stdout: args[0] === "--version" ? `ccusage ${CCUSAGE_VERSION}\n` : json };
} });
assert.equal(await meter.snapshot("codex", "session-1"), undefined);
assert.equal((await meter.snapshot("claude", "session-1"))?.totalTokens, 100);
assert.equal((await meter.snapshot("claude", "session-1"))?.totalTokens, 100);
assert.equal(calls.filter((args) => args[0] === "--version").length, 1);

const codexJsonl = [
  JSON.stringify({
    type: "session_meta",
    payload: { session_id: "codex-session-1", cli_version: "0.155.1" },
  }),
  JSON.stringify({
    type: "turn_context",
    payload: { turn_id: "turn-1", model: "gpt-5.6-sol" },
  }),
  JSON.stringify({
    type: "token_usage_record",
    payload: {
      session_id: "codex-session-1",
      thread_id: "codex-session-1",
      turn_id: "turn-1",
      turn_token_usage: {
        input_tokens: 100,
        cached_input_tokens: 40,
        cache_write_input_tokens: 3,
        output_tokens: 20,
        reasoning_output_tokens: 7,
        total_tokens: 120,
      },
      thread_token_usage: {
        input_tokens: 100,
        cached_input_tokens: 40,
        cache_write_input_tokens: 3,
        output_tokens: 20,
        reasoning_output_tokens: 7,
        total_tokens: 120,
      },
    },
  }),
  JSON.stringify({
    type: "turn_context",
    payload: { turn_id: "turn-2", model: "gpt-6-astra" },
  }),
  JSON.stringify({
    type: "token_usage_record",
    payload: {
      session_id: "codex-session-1",
      thread_id: "codex-session-1",
      turn_id: "turn-2",
      turn_token_usage: {
        input_tokens: 60,
        cached_input_tokens: 10,
        cache_write_input_tokens: 0,
        output_tokens: 8,
        reasoning_output_tokens: 2,
        total_tokens: 68,
      },
      thread_token_usage: {
        input_tokens: 160,
        cached_input_tokens: 50,
        cache_write_input_tokens: 3,
        output_tokens: 28,
        reasoning_output_tokens: 9,
        total_tokens: 188,
      },
    },
  }),
].join("\n");
const codexSnapshot = parseCodexSessionSnapshot(codexJsonl, "codex-session-1");
assert.equal(codexSnapshot?.meter, CODEX_JSONL_METER);
assert.equal(codexSnapshot?.meterVersion, "0.155.1");
assert.equal(codexSnapshot?.inputTokens, 160);
assert.equal(codexSnapshot?.outputTokens, 28);
assert.equal(codexSnapshot?.cacheReadTokens, 50);
assert.equal(codexSnapshot?.cacheCreationTokens, 3);
assert.equal(codexSnapshot?.totalTokens, 188);
assert.equal(codexSnapshot?.totalCost, 0);
assert.deepEqual(codexSnapshot?.modelBreakdowns, [
  {
    modelName: "gpt-5.6-sol",
    inputTokens: 100,
    outputTokens: 20,
    cacheCreationTokens: 3,
    cacheReadTokens: 40,
    cost: 0,
  },
  {
    modelName: "gpt-6-astra",
    inputTokens: 60,
    outputTokens: 8,
    cacheCreationTokens: 0,
    cacheReadTokens: 10,
    cost: 0,
  },
]);

const codexRoot = mkdtempSync(join(tmpdir(), "devspace-codex-meter-test-"));
try {
  const sessionDir = join(codexRoot, "sessions", "2026", "09", "25");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "rollout-codex-session-1.jsonl"), codexJsonl);
  const codexMeter = new CodexJsonlMeter({ sessionsRoot: join(codexRoot, "sessions") });
  assert.equal((await codexMeter.snapshot("codex", "codex-session-1"))?.totalTokens, 188);
  assert.equal(await codexMeter.snapshot("claude", "codex-session-1"), undefined);
  const chain = new LocalAgentUsageMeterChain([meter, codexMeter]);
  assert.equal((await chain.snapshot("claude", "session-1"))?.meter, "ccusage");
  assert.equal((await chain.snapshot("codex", "codex-session-1"))?.meter, CODEX_JSONL_METER);
} finally {
  rmSync(codexRoot, { recursive: true, force: true });
}
assert.equal(
  resolveCodexSessionsRoot({ CODEX_HOME: "/tmp/devspace-codex-home" }),
  "/tmp/devspace-codex-home/sessions",
);

const root = mkdtempSync(join(tmpdir(), "devspace-metering-test-"));
const store = new LocalAgentStore(root);
try {
  const agent = store.create({
    workspaceRoot: join(root, "project"),
    profileName: "reviewer",
    provider: "claude",
  });
  const first = store.beginTurn(agent.id, { prompt: "first" });
  store.update(agent.id, { providerSessionId: "session-1" });
  const snapshot = parseCcusageSessionSnapshot(json, "session-1")!;
  store.recordUsageSnapshot(agent.id, first.turn.id, snapshot, true, "2026-09-24T00:00:00.000Z");
  store.finishTurn(agent.id, first.turn.id, { status: "completed", response: "done" });
  const second = store.beginTurn(agent.id, { prompt: "second" });
  store.recordUsageSnapshot(agent.id, second.turn.id, {
    ...snapshot,
    inputTokens: 15,
    totalTokens: 105,
    totalCost: 0.75,
    modelBreakdowns: [{ ...snapshot.modelBreakdowns[0]!, inputTokens: 15, cost: 0.75 }],
  }, false, "2026-09-25T00:00:00.000Z");
  store.finishTurn(agent.id, second.turn.id, { status: "completed", response: "done" });
  const summary = store.usageSummary({ provider: "claude", days: 30, now: new Date("2026-09-25T01:00:00.000Z") });
  assert.equal(summary.runs, 2);
  assert.equal(summary.completeRuns, 2);
  assert.equal(summary.totalCost, 0.75);

  const rotated = store.beginTurn(agent.id, { prompt: "rotated" });
  store.update(agent.id, { providerSessionId: "session-2" });
  store.recordUsageSnapshot(agent.id, rotated.turn.id, {
    ...snapshot,
    providerSessionId: "session-2",
  }, false, "2026-09-25T00:30:00.000Z");
  const afterRotation = store.usageSummary({ provider: "claude", days: 30, now: new Date("2026-09-25T01:00:00.000Z") });
  assert.equal(afterRotation.recentRuns[0]?.complete, false);
  assert.equal(afterRotation.totalCost, 0.75);

  const codexAgent = store.create({
    workspaceRoot: join(root, "codex-project"),
    profileName: "codex-implement",
    provider: "codex",
    model: "gpt-5.6-sol",
    effort: "medium",
  });
  const codexTurn = store.beginTurn(codexAgent.id, { prompt: "implement" });
  store.update(codexAgent.id, { providerSessionId: "codex-session-1" });
  store.recordUsageSnapshot(
    codexAgent.id,
    codexTurn.turn.id,
    codexSnapshot!,
    true,
    "2026-09-25T00:45:00.000Z",
  );
  const codexSummary = store.usageSummary({
    provider: "codex",
    days: 7,
    now: new Date("2026-09-25T01:00:00.000Z"),
  });
  assert.equal(codexSummary.runs, 1);
  assert.equal(codexSummary.totalTokens, 188);
  assert.equal(codexSummary.totalCost, 0);
  assert.equal(codexSummary.byProject[0]?.name, join(root, "codex-project"));
  assert.equal(codexSummary.byProject[0]?.totalTokens, 188);
  assert.equal(codexSummary.byDay[0]?.runs, 1);
  assert.deepEqual(codexSummary.byModel.map((group) => [group.name, group.totalTokens]), [
    ["gpt-5.6-sol", 120],
    ["gpt-6-astra", 68],
  ]);
} finally {
  store.close();
  rmSync(root, { recursive: true, force: true });
}
