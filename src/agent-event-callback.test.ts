import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
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
const receiver = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  requests.push({
    authorization: request.headers.authorization,
    body: Buffer.concat(chunks).toString("utf8"),
  });
  response.statusCode = responseStatus;
  response.end();
});

try {
  await new Promise<void>((resolve, reject) => {
    receiver.once("error", reject);
    receiver.listen(0, "127.0.0.1", resolve);
  });
  const address = receiver.address();
  if (!address || typeof address === "string") throw new Error("Callback receiver did not bind TCP.");
  const callbackUrl = `http://127.0.0.1:${address.port}/agent-events`;
  const config = { url: callbackUrl, token: "receiver-token", timeoutMs: 1_000 };

  const parsed = loadAgentCallbackConfig({
    DEVSPACE_AGENT_CALLBACK_URL: `${callbackUrl}#ignored`,
    DEVSPACE_AGENT_CALLBACK_TOKEN: " exact token ",
    DEVSPACE_AGENT_CALLBACK_TIMEOUT_MS: "1234",
  });
  assert.equal(parsed.url, callbackUrl);
  assert.equal(parsed.token, " exact token ");
  assert.equal(parsed.timeoutMs, 1_234);
  assert.throws(() => loadAgentCallbackConfig({
    DEVSPACE_AGENT_CALLBACK_URL: "file:///tmp/callback",
  }), /protocol/);
  assert.throws(() => loadAgentCallbackConfig({
    DEVSPACE_AGENT_CALLBACK_URL: "https://user:secret@example.test/events",
  }), /must not contain credentials/);
  assert.throws(() => loadAgentCallbackConfig({
    DEVSPACE_AGENT_CALLBACK_TOKEN: "bad\ntoken",
  }), /must not contain newlines/);
  const scrubbedEnvironment = {
    DEVSPACE_AGENT_CALLBACK_URL: callbackUrl,
    DEVSPACE_AGENT_CALLBACK_TOKEN: "secret",
    DEVSPACE_AGENT_CALLBACK_TIMEOUT_MS: "1000",
    PRESERVED: "yes",
  };
  clearAgentCallbackEnvironment(scrubbedEnvironment);
  assert.deepEqual(scrubbedEnvironment, { PRESERVED: "yes" });

  const successfulAgent = store.create({
    workspaceId: "ws_callback",
    workspaceRoot: join(root, "project"),
    profileName: "worker",
    provider: "codex",
  });
  const successfulTurn = store.startTurn(successfulAgent.id);
  const successfulSettlement = store.settle(successfulAgent.id, {
    status: "idle",
    providerSessionId: "provider-session-callback",
    latestResponse: "private response must not leave the database",
  }, { emitEvent: true, expectedTurnId: successfulTurn.currentTurnId! });
  assert.ok(successfulSettlement.event);

  const disabled = await deliverAgentEvent(
    store,
    successfulSettlement.event,
    { timeoutMs: 100 },
  );
  assert.equal(disabled.outcome, "disabled");
  assert.equal(requests.length, 0);

  const delivered = await deliverAgentEvent(store, successfulSettlement.event, config);
  assert.equal(delivered.outcome, "delivered");
  assert.equal(requests[0]?.authorization, "Bearer receiver-token");
  assert.equal(requests[0]?.body, successfulSettlement.event.payloadJson);
  assert.doesNotMatch(requests[0]?.body ?? "", /private response|receiver-token/);
  assert.equal(store.getEvent(successfulSettlement.event.eventId)?.attempts, 1);
  assert.equal(store.getEvent(successfulSettlement.event.eventId)?.deliveryState, "delivered");

  const failedAgent = store.create({
    workspaceRoot: join(root, "project"),
    profileName: "reviewer",
    provider: "claude",
  });
  const failedTurn = store.startTurn(failedAgent.id);
  const failedSettlement = store.settle(failedAgent.id, {
    status: "error",
    error: "private provider error must not leave the database",
    errorCode: "PROVIDER_EXECUTION_ERROR",
    errorRetryable: false,
  }, { emitEvent: true, expectedTurnId: failedTurn.currentTurnId! });
  assert.ok(failedSettlement.event);

  responseStatus = 503;
  const rejected = await drainPendingAgentEvents(store, config);
  assert.equal(rejected.failed, 1);
  assert.equal(store.getEvent(failedSettlement.event.eventId)?.attempts, 1);
  assert.equal(store.getEvent(failedSettlement.event.eventId)?.lastError, "HTTP 503");
  assert.equal(store.getById(failedAgent.id)?.error, "private provider error must not leave the database");

  const dispatcher = new AgentEventDispatcher({
    stateDir: root,
    config,
    retryIntervalMs: 20,
  });
  await dispatcher.start();
  assert.equal(dispatcher.hasPendingEvents(), true);
  responseStatus = 204;
  await waitFor(() => store.getEvent(failedSettlement.event!.eventId)?.deliveryState === "delivered");
  assert.ok((store.getEvent(failedSettlement.event.eventId)?.attempts ?? 0) >= 3);
  assert.equal(dispatcher.hasPendingEvents(), false);
  await dispatcher.close();
} finally {
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
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
