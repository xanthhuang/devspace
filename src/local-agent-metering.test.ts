import assert from "node:assert/strict";
import {
  CCUSAGE_METER,
  CCUSAGE_VERSION,
  CcusageMeter,
  parseCcusageSessionSnapshot,
  resolveCcusageCommand,
} from "./local-agent-metering.js";

const output = JSON.stringify({
  sessions: [
    {
      sessionId: "other",
      inputTokens: 999,
      outputTokens: 999,
      cacheCreationTokens: 999,
      cacheReadTokens: 999,
      totalTokens: 3996,
      totalCost: 9.99,
      modelBreakdowns: [],
    },
    {
      sessionId: "claude_session_1",
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationTokens: 30,
      cacheReadTokens: 40,
      totalTokens: 100,
      totalCost: 0.25,
      modelBreakdowns: [{
        modelName: "claude-opus-5",
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationTokens: 30,
        cacheReadTokens: 40,
        cost: 0.25,
      }],
    },
  ],
});

assert.deepEqual(parseCcusageSessionSnapshot(output, "claude_session_1"), {
  provider: "claude",
  providerSessionId: "claude_session_1",
  meter: CCUSAGE_METER,
  meterVersion: CCUSAGE_VERSION,
  inputTokens: 10,
  outputTokens: 20,
  cacheCreationTokens: 30,
  cacheReadTokens: 40,
  totalTokens: 100,
  totalCost: 0.25,
  modelBreakdowns: [{
    modelName: "claude-opus-5",
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationTokens: 30,
    cacheReadTokens: 40,
    cost: 0.25,
  }],
});
assert.equal(parseCcusageSessionSnapshot(output, "missing"), undefined);
assert.throws(() => parseCcusageSessionSnapshot("{}", "missing"), /sessions/);

const invocations: Array<{ command: string; args: readonly string[] }> = [];
const meter = new CcusageMeter({
  env: { DEVSPACE_CCUSAGE_COMMAND: "/opt/ccusage-20.0.24" },
  execute: async (command, args) => {
    invocations.push({ command, args });
    return {
      stdout: args[0] === "--version"
        ? `ccusage ${CCUSAGE_VERSION}\n`
        : output,
    };
  },
});
const snapshot = await meter.snapshot("claude", "claude_session_1");
assert.equal(snapshot?.totalCost, 0.25);
assert.deepEqual(invocations, [
  {
    command: "/opt/ccusage-20.0.24",
    args: ["--version"],
  },
  {
    command: "/opt/ccusage-20.0.24",
    args: ["claude", "session", "--json", "--offline", "--mode", "calculate"],
  },
]);
await meter.snapshot("claude", "claude_session_1");
assert.equal(
  invocations.filter(({ args }) => args[0] === "--version").length,
  1,
  "the pinned ccusage executable is version-checked once per meter instance",
);
assert.equal(await meter.snapshot("codex", "thread_1"), undefined);
assert.equal(resolveCcusageCommand({ DEVSPACE_CCUSAGE_COMMAND: " /custom/ccusage " }), "/custom/ccusage");
assert.equal(resolveCcusageCommand({}), "ccusage");

const wrongVersion = new CcusageMeter({
  command: "/opt/ccusage",
  execute: async (_command, args) => (
    args[0] === "--version"
      ? { stdout: "ccusage 20.0.25\n" }
      : { stdout: output }
  ),
});
await assert.rejects(
  wrongVersion.snapshot("claude", "claude_session_1"),
  /version mismatch: expected 20\.0\.24, got 20\.0\.25/,
);

let versionAttempts = 0;
const transientVersionFailure = new CcusageMeter({
  command: "/opt/ccusage",
  execute: async (_command, args) => {
    if (args[0] !== "--version") return { stdout: output };
    versionAttempts += 1;
    if (versionAttempts === 1) throw new Error("temporary ccusage failure");
    return { stdout: "ccusage 20.0.24\n" };
  },
});
await assert.rejects(
  transientVersionFailure.snapshot("claude", "claude_session_1"),
  /temporary ccusage failure/,
);
assert.equal(
  (await transientVersionFailure.snapshot("claude", "claude_session_1"))?.totalCost,
  0.25,
  "a transient version-probe failure is retried on the next turn",
);

const missingSession = new CcusageMeter({
  command: "/opt/ccusage",
  execute: async (_command, args) => (
    args[0] === "--version"
      ? { stdout: "ccusage 20.0.24\n" }
      : { stdout: JSON.stringify({ sessions: [] }) }
  ),
});
await assert.rejects(
  missingSession.snapshot("claude", "missing"),
  /did not report Claude session missing/,
);
