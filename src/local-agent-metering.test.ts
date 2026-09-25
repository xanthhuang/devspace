import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CCUSAGE_VERSION,
  CcusageMeter,
  parseCcusageSessionSnapshot,
  resolveCcusageCommand,
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
} finally {
  store.close();
  rmSync(root, { recursive: true, force: true });
}
