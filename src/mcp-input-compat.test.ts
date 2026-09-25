import assert from "node:assert/strict";
import test from "node:test";
import {
  LegacyMcpArgumentConflictError,
  normalizeLegacyMcpToolArguments,
} from "./mcp-input-compat.js";

test("legacy tool arguments normalize without changing canonical tool schemas", () => {
  const normalized = normalizeLegacyMcpToolArguments({
    jsonrpc: "2.0",
    id: "legacy-exec",
    method: "tools/call",
    params: {
      name: "exec_command",
      arguments: {
        workspaceId: "ws_1",
        cmd: "true",
        workingDirectory: "nested",
        yieldTimeMs: 100,
        maxOutputTokens: 200,
        untouched: "value",
      },
      _meta: { keep: true },
    },
  }) as Record<string, any>;

  assert.deepEqual(normalized.params.arguments, {
    workspace_id: "ws_1",
    cmd: "true",
    working_directory: "nested",
    yield_time_ms: 100,
    max_output_tokens: 200,
    untouched: "value",
  });
  assert.deepEqual(normalized.params._meta, { keep: true });
});

test("canonical and identical legacy values coexist safely", () => {
  const normalized = normalizeLegacyMcpToolArguments({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "read",
      arguments: { workspace_id: "ws_1", workspaceId: "ws_1", path: "README.md" },
    },
  }) as Record<string, any>;

  assert.deepEqual(normalized.params.arguments, {
    workspace_id: "ws_1",
    path: "README.md",
  });
});

test("conflicting legacy and canonical values fail with the original request id", () => {
  assert.throws(
    () => normalizeLegacyMcpToolArguments({
      jsonrpc: "2.0",
      id: "conflict-1",
      method: "tools/call",
      params: {
        name: "write_stdin",
        arguments: { workspace_id: "ws_new", workspaceId: "ws_old", session_id: 1 },
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof LegacyMcpArgumentConflictError);
      assert.equal(error.requestId, "conflict-1");
      assert.equal(error.legacyName, "workspaceId");
      assert.equal(error.canonicalName, "workspace_id");
      return true;
    },
  );
});

test("batch requests normalize tool calls and preserve unrelated messages", () => {
  const untouched = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
  const normalized = normalizeLegacyMcpToolArguments([
    untouched,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "open_workspace",
        arguments: { path: "/tmp/project", mode: "worktree", baseRef: "main" },
      },
    },
  ]) as Array<Record<string, any>>;

  assert.equal(normalized[0], untouched);
  assert.deepEqual(normalized[1]?.params.arguments, {
    path: "/tmp/project",
    mode: "worktree",
    base_ref: "main",
  });
});

test("historical Claude edit entries normalize nested oldText and newText aliases", () => {
  const normalized = normalizeLegacyMcpToolArguments({
    jsonrpc: "2.0",
    id: "legacy-edit",
    method: "tools/call",
    params: {
      name: "edit",
      arguments: {
        workspaceId: "ws_1",
        path: "note.txt",
        edits: [{ oldText: "before", newText: "after" }],
      },
    },
  }) as Record<string, any>;

  assert.deepEqual(normalized.params.arguments, {
    workspace_id: "ws_1",
    path: "note.txt",
    edits: [{ old_text: "before", new_text: "after" }],
  });
});
