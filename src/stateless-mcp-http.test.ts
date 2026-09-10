import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "./config.js";
import { SingleUserOAuthProvider } from "./oauth-provider.js";
import { SqliteOAuthStore } from "./oauth-store.js";
import { createServer } from "./server.js";
import { WorkspaceRegistry } from "./workspaces.js";

const PROTOCOL_VERSION = "2025-06-18";
const WORKSPACE_APP_URI = "ui://devspace/workspace-app.html";

test("OAuth protected-resource metadata is available at root and MCP-specific discovery URLs", async (t) => {
  const fixture = await startFixture();
  t.after(() => cleanupFixture(fixture));

  const rootMetadataUrl = new URL("/.well-known/oauth-protected-resource", fixture.endpoint);
  const mcpMetadataUrl = new URL("/.well-known/oauth-protected-resource/mcp", fixture.endpoint);
  const [rootResponse, mcpResponse] = await Promise.all([
    fetch(rootMetadataUrl),
    fetch(mcpMetadataUrl),
  ]);

  assert.equal(rootResponse.status, 200);
  assert.equal(mcpResponse.status, 200);

  const rootMetadata = await rootResponse.json();
  const mcpMetadata = await mcpResponse.json();
  assert.deepEqual(rootMetadata, mcpMetadata);
  assert.deepEqual(rootMetadata, {
    resource: "http://127.0.0.1:1/mcp",
    authorization_servers: ["http://127.0.0.1:1/"],
    scopes_supported: ["devspace"],
    resource_name: "DevSpace",
  });
});

test("sustained stateless cycles release every request server", async (t) => {
  await ensureUiBuildFixture(t);
  const originalConnect = McpServer.prototype.connect;
  const originalClose = McpServer.prototype.close;
  const connectedServers = new WeakSet<McpServer>();
  let connected = 0;
  let closed = 0;

  McpServer.prototype.connect = async function patchedConnect(transport) {
    await originalConnect.call(this, transport);
    connectedServers.add(this);
    connected += 1;
  };
  McpServer.prototype.close = async function patchedClose() {
    try {
      await originalClose.call(this);
    } finally {
      if (connectedServers.delete(this)) closed += 1;
    }
  };

  const fixture = await startFixture(true);
  try {
    for (let index = 0; index < 75; index += 1) {
      const initialized = await postMcp(
        fixture,
        initializeRequest(index * 2 + 1, "stateless-cycle-test"),
      );
      assert.equal(initialized.status, 200);
      assert.equal(initialized.headers.get("mcp-session-id"), null);
      await initialized.text();

      const resource = await postMcp(
        fixture,
        {
          jsonrpc: "2.0",
          id: index * 2 + 2,
          method: "resources/read",
          params: { uri: WORKSPACE_APP_URI },
        },
        { "mcp-protocol-version": PROTOCOL_VERSION },
      );
      assert.equal(resource.status, 200);
      assert.equal(resource.headers.get("mcp-session-id"), null);
      assert.match(await resource.text(), /ui:\/\/devspace\/workspace-app\.html/);

      await waitFor(() => closed === connected);
      assert.equal(connected, (index + 1) * 2);
    }
    assert.equal(closed, connected);
  } finally {
    McpServer.prototype.connect = originalConnect;
    McpServer.prototype.close = originalClose;
    await cleanupFixture(fixture);
  }
});

test("real SDK client uses stateless Streamable HTTP without a session id", async (t) => {
  await ensureUiBuildFixture(t);
  const fixture = await startFixture(true);
  t.after(() => cleanupFixture(fixture));

  const transport = new StreamableHTTPClientTransport(new URL(fixture.endpoint), {
    requestInit: { headers: { authorization: `Bearer ${fixture.token}` } },
  });
  const client = new Client({ name: "stateless-sdk-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    assert.equal(transport.sessionId, undefined);
    assert.equal((await client.readResource({ uri: WORKSPACE_APP_URI })).contents.length, 1);
    assert.equal(transport.sessionId, undefined);
  } finally {
    await client.close();
  }
});

test("shutdown closes and waits for an active request server", async (t) => {
  const fixture = await startFixture();
  const originalClose = McpServer.prototype.close;
  const started = deferred();
  const release = deferred();
  McpServer.prototype.close = async function patchedClose() {
    started.resolve();
    await release.promise;
    await originalClose.call(this);
  };
  t.after(async () => {
    McpServer.prototype.close = originalClose;
    release.resolve();
    await cleanupFixture(fixture);
  });

  const initialized = await postMcp(fixture, initializeRequest(1, "shutdown-test"));
  assert.equal(initialized.status, 200);
  await initialized.text();
  await started.promise;

  const firstClose = fixture.running.close();
  const secondClose = fixture.running.close();
  assert.equal(firstClose, secondClose);
  const shutdown = tracked(firstClose);
  await nextTurn();
  assert.equal(shutdown.done(), false);

  const rejected = await postMcp(fixture, initializeRequest(2, "shutdown-rejected"));
  assert.equal(rejected.status, 503);
  assert.match(await rejected.text(), /Server is shutting down/);

  release.resolve();
  await shutdown.promise;
});

test("shutdown admission lease covers in-flight authentication", async (t) => {
  const fixture = await startFixture();
  const originalVerify = SingleUserOAuthProvider.prototype.verifyAccessToken;
  const started = deferred();
  const release = deferred();
  SingleUserOAuthProvider.prototype.verifyAccessToken = async function patchedVerify(token) {
    started.resolve();
    await release.promise;
    return originalVerify.call(this, token);
  };
  t.after(async () => {
    SingleUserOAuthProvider.prototype.verifyAccessToken = originalVerify;
    release.resolve();
    await cleanupFixture(fixture);
  });

  const request = postMcp(fixture, initializeRequest(1, "auth-shutdown-test"));
  await started.promise;
  const shutdown = tracked(fixture.running.close());
  await nextTurn();
  assert.equal(shutdown.done(), false);

  release.resolve();
  const response = await request;
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Server is shutting down/);
  await shutdown.promise;
});

test("shutdown waits for an independently tracked tool handler", async (t) => {
  const fixture = await startFixture();
  const originalOpenWorkspace = WorkspaceRegistry.prototype.openWorkspace;
  const started = deferred();
  const release = deferred();
  WorkspaceRegistry.prototype.openWorkspace = async function patchedOpenWorkspace(input, options) {
    started.resolve();
    await release.promise;
    return originalOpenWorkspace.call(this, input, options);
  };
  t.after(async () => {
    WorkspaceRegistry.prototype.openWorkspace = originalOpenWorkspace;
    release.resolve();
    await cleanupFixture(fixture);
  });

  const toolRequest = postMcp(
    fixture,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "open_workspace", arguments: { path: fixture.project } },
    },
    { "mcp-protocol-version": PROTOCOL_VERSION },
  ).catch(() => undefined);
  await started.promise;

  const shutdown = tracked(fixture.running.close());
  await nextTurn();
  assert.equal(shutdown.done(), false);
  release.resolve();
  await shutdown.promise;
  await toolRequest;
});

const packagedCliPath = join(process.cwd(), "dist", "cli.js");
test(
  "packaged CLI can restart and serve stateless MCP from the same durable OAuth state",
  { skip: !existsSync(packagedCliPath) && "run npm build before the packaged smoke test" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "devspace-stateless-cli-"));
    const project = join(root, "project");
    const configDir = join(root, ".config");
    const stateDir = join(root, ".state");
    const token = "packaged-stateless-mcp-access-token";
    await mkdir(project);
    try {
      const port = await reservePort();
      const publicBaseUrl = `http://127.0.0.1:${port}`;
      const endpoint = new URL("/mcp", publicBaseUrl);
      authorizeToken(stateDir, publicBaseUrl, token);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const child = spawn(process.execPath, [packagedCliPath, "serve"], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            HOST: "127.0.0.1",
            PORT: String(port),
            DEVSPACE_ALLOWED_ROOTS: project,
            DEVSPACE_CONFIG_DIR: configDir,
            DEVSPACE_STATE_DIR: stateDir,
            DEVSPACE_PUBLIC_BASE_URL: publicBaseUrl,
            DEVSPACE_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
            DEVSPACE_LOG_LEVEL: "silent",
            DEVSPACE_SUBAGENTS: "0",
          },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        try {
          await waitForHealth(child, new URL("/healthz", publicBaseUrl).href);
          const transport = new StreamableHTTPClientTransport(endpoint, {
            requestInit: { headers: { authorization: `Bearer ${token}` } },
          });
          const client = new Client({
            name: `packaged-stateless-restart-${attempt + 1}`,
            version: "1.0.0",
          });
          assert.equal(transport.sessionId, undefined);
          await client.connect(transport);
          try {
            assert.equal(transport.sessionId, undefined);
            const tools = await client.listTools();
            assert.ok(tools.tools.length > 0);
            assert.equal(transport.sessionId, undefined);
          } finally {
            await client.close();
          }
          assert.equal(transport.sessionId, undefined);
        } finally {
          await stopChild(child);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

type Fixture = Awaited<ReturnType<typeof startFixture>>;

async function startFixture(widgets = false) {
  const root = await mkdtemp(join(tmpdir(), "devspace-stateless-http-"));
  const project = join(root, "project");
  const stateDir = join(root, ".state");
  const publicBaseUrl = "http://127.0.0.1:1";
  const token = "stateless-mcp-test-access-token";
  await mkdir(project);

  const config = loadConfig({
    DEVSPACE_CONFIG_DIR: join(root, ".config"),
    DEVSPACE_STATE_DIR: stateDir,
    DEVSPACE_ALLOWED_ROOTS: project,
    DEVSPACE_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    DEVSPACE_PUBLIC_BASE_URL: publicBaseUrl,
    DEVSPACE_LOG_LEVEL: "silent",
    ...(widgets ? { DEVSPACE_WIDGETS: "changes" } : {}),
    PORT: "1",
  });
  authorizeToken(stateDir, publicBaseUrl, token);
  const running = createServer(config);

  const httpServer = await listen(running.app);
  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  return {
    root,
    project,
    token,
    running,
    httpServer,
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
  };
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await close(fixture.httpServer);
  await fixture.running.close();
  await rm(fixture.root, { recursive: true, force: true });
}

function initializeRequest(id: number, name: string): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name, version: "1.0.0" },
    },
  };
}

function postMcp(
  fixture: Fixture,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(fixture.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${fixture.token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function authorizeToken(stateDir: string, publicBaseUrl: string, token: string): void {
  const store = new SqliteOAuthStore(stateDir);
  const client = store.registerClient(
    {
      client_name: "Stateless MCP Test",
      redirect_uris: ["http://127.0.0.1/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    ["127.0.0.1"],
  );
  store.saveAccessToken(createHash("sha256").update(token).digest("base64url"), {
    clientId: client.client_id,
    scopes: ["devspace"],
    expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    resource: resourceUrlFromServerUrl(new URL("/mcp", publicBaseUrl)).href,
  });
  store.close();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function tracked(promise: Promise<void>) {
  let finished = false;
  return {
    promise: promise.then(() => { finished = true; }),
    done: () => finished,
  };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await nextTurn();
  }
  assert.fail("request-scoped MCP servers did not return to zero active resources");
}

async function ensureUiBuildFixture(t: TestContext): Promise<void> {
  const uiRoot = join(process.cwd(), "dist", "ui");
  const manifestPath = join(uiRoot, ".vite", "manifest.json");
  if (existsSync(manifestPath)) return;

  const scriptPath = join(uiRoot, "assets", "workspace-app-stateless-test.js");
  const stylesheetPath = join(uiRoot, "assets", "workspace-app-stateless-test.css");
  t.after(async () => {
    await Promise.all([
      rm(manifestPath, { force: true }),
      rm(scriptPath, { force: true }),
      rm(stylesheetPath, { force: true }),
    ]);
  });

  await mkdir(join(uiRoot, ".vite"), { recursive: true });
  await mkdir(join(uiRoot, "assets"), { recursive: true });
  await writeFile(manifestPath, JSON.stringify({
    "workspace-app.html": {
      file: "assets/workspace-app-stateless-test.js",
      css: ["assets/workspace-app-stateless-test.css"],
    },
  }));
  await writeFile(scriptPath, "export {};\n");
  await writeFile(stylesheetPath, "/* stateless MCP test fixture */\n");
}

function listen(app: ReturnType<typeof createServer>["app"]): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function reservePort(): Promise<number> {
  const server = await new Promise<Server>((resolve, reject) => {
    const candidate = createHttpServer();
    candidate.once("error", reject);
    candidate.listen(0, "127.0.0.1", () => resolve(candidate));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await close(server);
  return port;
}

async function waitForHealth(child: ChildProcess, url: string): Promise<void> {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      assert.fail(`packaged CLI exited before health check (code ${child.exitCode})\n${stdout}\n${stderr}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        assert.deepEqual(await response.json(), { ok: true, name: "devspace" });
        return;
      }
    } catch {
      // The child has not bound the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`packaged CLI did not become healthy\n${stdout}\n${stderr}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("packaged CLI did not stop")), 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill();
  });
}
