import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentEventDispatcher,
  clearAgentCallbackEnvironment,
  deliverAgentEvent,
  drainPendingAgentEvents,
  loadAgentCallbackConfig,
} from "./agent-event-callback.js";
import { LocalAgentStore } from "./local-agent-store.js";

const root = mkdtempSync(join(tmpdir(), "devspace-agent-event-callback-test-"));
const store = new LocalAgentStore(root);
const requests: Array<{ authorization?: string; body: string }> = [];
let responseStatus = 204;
const callbackFetch: typeof fetch = async (_input, init) => {
  const headers = new Headers(init?.headers);
  requests.push({
    authorization: headers.get("authorization") ?? undefined,
    body: String(init?.body ?? ""),
  });
  return new Response(null, { status: responseStatus });
};

try {
  const callbackUrl = "https://callbacks.example.test/agent-events";
  const config = { url: callbackUrl, token: "receiver-token", timeoutMs: 1_000 };

  const parsed = loadAgentCallbackConfig({
    DEVSPACE_AGENT_CALLBACK_URL: `${callbackUrl}#ignored`,
    DEVSPACE_AGENT_CALLBACK_TOKEN: " exact token ",
    DEVSPACE_AGENT_CALLBACK_TIMEOUT_MS: "1234",
  });
  assert.equal(parsed.url, callbackUrl);
  assert.equal(parsed.token, " exact token ");
  assert.equal(parsed.timeoutMs, 1_234);
  assert.throws(() => loadAgentCallbackConfig({ DEVSPACE_AGENT_CALLBACK_URL: "file:///tmp/callback" }), /protocol/);
  assert.throws(
    () => loadAgentCallbackConfig({ DEVSPACE_AGENT_CALLBACK_URL: "https://user:secret@example.test/events" }),
    /must not contain credentials/,
  );
  assert.throws(() => loadAgentCallbackConfig({ DEVSPACE_AGENT_CALLBACK_TOKEN: "bad\ntoken" }), /newlines/);
  const scrubbed = {
    DEVSPACE_AGENT_CALLBACK_URL: callbackUrl,
    DEVSPACE_AGENT_CALLBACK_TOKEN: "secret",
    DEVSPACE_AGENT_CALLBACK_TIMEOUT_MS: "1000",
    PRESERVED: "yes",
  };
  clearAgentCallbackEnvironment(scrubbed);
  assert.deepEqual(scrubbed, { PRESERVED: "yes" });

  const successfulAgent = store.create({
    workspaceId: "ws_callback",
    workspaceRoot: join(root, "project"),
    profileName: "worker",
    provider: "codex",
  });
  const successfulTurn = store.beginTurn(successfulAgent.id, { prompt: "work" });
  const successful = store.finishTurnWithEvent(successfulAgent.id, successfulTurn.turn.id, {
    status: "completed",
    providerSessionId: "provider-session-callback",
    response: "private response must not leave the database",
  }, true);
  assert.ok(successful.event);

  const disabled = await deliverAgentEvent(store, successful.event, { timeoutMs: 100 });
  assert.equal(disabled.outcome, "disabled");
  assert.equal(requests.length, 0);
  const delivered = await deliverAgentEvent(store, successful.event, config, callbackFetch);
  assert.equal(delivered.outcome, "delivered");
  assert.equal(requests[0]?.authorization, "Bearer receiver-token");
  assert.equal(requests[0]?.body, successful.event.payloadJson);
  assert.doesNotMatch(requests[0]?.body ?? "", /private response|receiver-token/);
  assert.equal(store.getEvent(successful.event.eventId)?.attempts, 1);

  const failedAgent = store.create({
    workspaceRoot: join(root, "project"),
    profileName: "reviewer",
    provider: "claude",
  });
  const failedTurn = store.beginTurn(failedAgent.id, { prompt: "fail" });
  const failed = store.finishTurnWithEvent(failedAgent.id, failedTurn.turn.id, {
    status: "failed",
    error: "private provider error must not leave the database",
    errorCode: "PROVIDER_EXECUTION_ERROR",
    errorRetryable: false,
  }, true);
  assert.ok(failed.event);

  responseStatus = 503;
  const rejected = await drainPendingAgentEvents(store, config, callbackFetch);
  assert.equal(rejected.failed, 1);
  assert.equal(store.getEvent(failed.event.eventId)?.lastError, "HTTP 503");
  const dispatcher = new AgentEventDispatcher({
    stateDir: root,
    config,
    fetchImplementation: callbackFetch,
    retryIntervalMs: 20,
  });
  await dispatcher.start();
  responseStatus = 204;
  await waitFor(() => store.getEvent(failed.event!.eventId)?.deliveryState === "delivered");
  assert.ok((store.getEvent(failed.event.eventId)?.attempts ?? 0) >= 3);
  await dispatcher.close();
} finally {
  store.close();
  rmSync(root, { recursive: true, force: true });
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for callback retry.");
}
