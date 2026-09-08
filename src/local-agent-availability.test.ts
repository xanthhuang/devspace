import assert from "node:assert/strict";
import {
  checkLocalAgentProviderAvailability,
  formatLocalAgentProviderAvailabilitySummary,
  getLocalAgentProviderAvailabilitySnapshot,
} from "./local-agent-availability.js";

{
  const availability = checkLocalAgentProviderAvailability("codex");
  assert.equal(availability.name, "codex");
  assert.equal(typeof availability.available, "boolean");
  if (availability.available) {
    assert.equal(availability.note, "available");
  }
}

{
  const availability = checkLocalAgentProviderAvailability("codex", {
    ...process.env,
    CODEX_COMMAND: "/definitely/missing/devspace-codex",
  });
  assert.equal(availability.available, false);
  assert.match(availability.reason ?? "", /executable not found/);
}

{
  assert.equal(checkLocalAgentProviderAvailability("pi").available, true);
}

if (process.platform === "win32") {
  const blocked = checkLocalAgentProviderAvailability("claude", {
    ...process.env,
    DEVSPACE_CLAUDE_ALLOW_UNSANDBOXED_WINDOWS: undefined,
  });
  assert.equal(blocked.available, false);
  assert.match(blocked.reason ?? "", /DEVSPACE_CLAUDE_ALLOW_UNSANDBOXED_WINDOWS=1/);

  const optedIn = checkLocalAgentProviderAvailability("claude", {
    ...process.env,
    DEVSPACE_CLAUDE_ALLOW_UNSANDBOXED_WINDOWS: "1",
  });
  assert.equal(optedIn.available, true);
}

{
  const snapshot = getLocalAgentProviderAvailabilitySnapshot({
    ...process.env,
    CODEX_COMMAND: "/definitely/missing/devspace-codex",
  });
  assert.deepEqual(
    snapshot.map((provider) => provider.name),
    ["codex", "claude", "opencode", "pi", "cursor", "copilot", "grok"],
  );
  assert.equal(snapshot.find((provider) => provider.name === "pi")?.available, true);
}

assert.equal(
  formatLocalAgentProviderAvailabilitySummary([
    { name: "codex", available: true, note: "available" },
    { name: "pi", available: false, reason: "pi executable not found" },
  ]),
  "available: codex (available); unavailable: pi (pi executable not found)",
);
