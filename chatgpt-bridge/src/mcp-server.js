#!/usr/bin/env node
/**
 * com.chefgroep.chatgpt-bridge — expose Herdr to chat clients over MCP.
 *
 * Modes:
 *   serve    Streamable-HTTP MCP server on 127.0.0.1 (default :8791), ready to be
 *            published through a tunnel/gateway for ChatGPT connectors.
 *   stdio    Newline-delimited JSON-RPC on stdin/stdout for local MCP clients.
 *   doctor   Print tool inventory, write-gate state and herdr reachability.
 *   stop     Kill a `serve` instance via its pidfile in HERDR_PLUGIN_STATE_DIR.
 *
 * Safety model (v1):
 *   - Read-only by default. Write tools (prompt an agent, desktop notification)
 *     only exist when CHEF_CHATGPT_ALLOW_WRITE=1.
 *   - HTTP binds 127.0.0.1 only. Set CHEF_CHATGPT_TOKEN to require
 *     `Authorization: Bearer <token>` on every request.
 */
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

const NAME = "herdr-chatgpt-bridge";
const VERSION = "0.2.2";
const PROTOCOL_VERSION = "2025-06-18";
const PORT_DEFAULT = 8791;
const CMD_TIMEOUT_MS = 20_000;
const CAPTURE_MAX_BYTES = 256 * 1024;
const BRIDGE_PID_FILE = "chatgpt-bridge.pid";
const BRIDGE_START_TIMEOUT_MS = 3_000;

const allowWrite = () => process.env.CHEF_CHATGPT_ALLOW_WRITE === "1";

function run(cmd, args, timeoutMs = CMD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) =>
        resolve({ ok: !err, stdout, stderr, error: err ? String(err.message || err) : null }),
    );
  });
}

async function herdr(args) {
  return run("herdr", args);
}

function redactCapture(input) {
  let redactions = 0;
  const replace = (pattern, replacement) => {
    input = input.replace(pattern, (...args) => {
      redactions += 1;
      return typeof replacement === "function" ? replacement(...args) : replacement;
    });
  };
  replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]");
  // Authorization: Bearer|Basic <token>
  replace(/\b(authorization\s*:\s*(?:bearer|basic)\s+)[^\s]+/gi, (match, prefix) => `${prefix}[REDACTED]`);
  // Standalone Bearer <token> (incl. JWT) — skip already-redacted
  replace(/\b(Bearer\s+)(?!\[REDACTED\])[^\s]+/gi, (match, prefix) => `${prefix}[REDACTED]`);
  // Compact JWTs not already caught by Bearer
  replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED JWT]");
  // JSON "api_key": "..." / "apiKey": "..." and related secret fields
  replace(/("(api[_-]?key|apiKey|access[_-]?token|client[_-]?secret|secret|password|token)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, (match, prefix) => `${prefix}"[REDACTED]"`);
  // Env-style OPENAI_API_KEY= / AWS_SECRET_ACCESS_KEY= / *_TOKEN= etc.
  replace(/\b([A-Z][A-Z0-9_]*(?:API[_-]?KEY|SECRET(?:[_-]?ACCESS)?[_-]?KEY|ACCESS[_-]?KEY(?:[_-]?ID)?|CLIENT[_-]?SECRET|SECRET|TOKEN|PASSWORD|PASSWD))(\s*=\s*)["']?[^\s"']+/g, (match, key, separator) => `${key}${separator}[REDACTED]`);
  replace(/\b(api[_-]?key|token|secret|password|passwd|client[_-]?secret)(\s*[:=]\s*)["']?[^\s"']+/gi, (match, key, separator) => `${key}${separator}[REDACTED]`);
  replace(/\b(ghp_|github_pat_|sk-|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/g, (match, prefix) => `${prefix}[REDACTED]`);
  replace(/:\/\/[^\s/@:]+:[^\s/@]+@/g, "://[REDACTED]@");
  return { text: input, redactions };
}

function safePaneId(value) {
  const pane = String(value || "");
  if (!/^[A-Za-z0-9_-]+:p[A-Za-z0-9]+$/.test(pane)) {
    throw new Error(`invalid pane id: ${pane || "<empty>"}`);
  }
  return pane;
}

function actionPaneTarget(env = process.env) {
  return env.HERDR_PANE_ID ? safePaneId(env.HERDR_PANE_ID) : "";
}

function boundedTail(value) {
  const raw = Buffer.from(String(value || "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""), "utf8");
  if (raw.length <= CAPTURE_MAX_BYTES) return raw.toString("utf8");

  let start = raw.length - CAPTURE_MAX_BYTES;
  while (start < raw.length && (raw[start] & 0xc0) === 0x80) start += 1;
  return raw.subarray(start).toString("utf8");
}

function selectCaptureAgent(snapshot, target = "") {
  const panes = snapshot.panes ?? [];
  const agents = snapshot.agents ?? [];
  if (!agents.length) throw new Error("no Herdr agent panes found");

  const requested = target ? safePaneId(target) : "";
  const focused = panes.find((pane) => pane.focused);
  const directPaneId = requested || focused?.pane_id || "";
  const direct = agents.find((agent) => agent.pane_id === directPaneId);
  if (direct?.pane_id) return safePaneId(direct.pane_id);

  const contextPane = panes.find((pane) => pane.pane_id === requested) || focused;
  const statusRank = {
    working: 5,
    running: 5,
    waiting: 4,
    needs_input: 4,
    idle: 3,
    done: 2,
    unknown: 1,
  };
  const ranked = [...agents].sort((left, right) => {
    const affinity = (agent) => {
      if (!contextPane) return 0;
      if (agent.tab_id === contextPane.tab_id) return 2;
      if (agent.workspace_id === contextPane.workspace_id) return 1;
      return 0;
    };
    const leftKey = [
      affinity(left),
      statusRank[left.agent_status] ?? 0,
      Number(left.state_change_seq ?? 0),
      Number(left.revision ?? 0),
    ];
    const rightKey = [
      affinity(right),
      statusRank[right.agent_status] ?? 0,
      Number(right.state_change_seq ?? 0),
      Number(right.revision ?? 0),
    ];
    for (let index = 0; index < leftKey.length; index += 1) {
      if (leftKey[index] !== rightKey[index]) return rightKey[index] - leftKey[index];
    }
    return String(left.pane_id).localeCompare(String(right.pane_id));
  });
  if (!ranked[0]?.pane_id) throw new Error("no suitable Herdr agent pane found");
  return safePaneId(ranked[0].pane_id);
}

async function capturePaneId(target = "") {
  const res = await herdr(["api", "snapshot"]);
  if (!res.ok) throw new Error(res.error || res.stderr || "Herdr snapshot failed");
  const snapshot = JSON.parse(res.stdout)?.result?.snapshot ?? {};
  return selectCaptureAgent(snapshot, target);
}

async function captureAgent(target = "") {
  const pane = await capturePaneId(target);
  const res = await herdr([
    "agent", "read", pane,
    "--source", "recent-unwrapped",
    "--lines", "400",
    "--format", "text",
  ]);
  if (!res.ok) throw new Error(res.error || res.stderr || "Herdr agent read failed");

  const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!stateDir) throw new Error("HERDR_PLUGIN_STATE_DIR is required for capture");
  const exportDir = path.join(stateDir, "exports");
  await mkdir(exportDir, { recursive: true, mode: 0o700 });

  const capturedAt = new Date().toISOString();
  const stamp = capturedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const fileName = `${stamp}-${pane.replace(":", "-")}-${randomUUID()}.md`;
  const targetPath = path.join(exportDir, fileName);
  const tmpPath = `${targetPath}.${randomUUID()}.tmp`;
  const bounded = boundedTail(res.stdout);
  const redacted = redactCapture(bounded);
  const body = [
    `# Herdr agent capture: ${pane}`,
    "",
    `- captured_at: ${capturedAt}`,
    "- source: recent-unwrapped",
    `- byte_cap: ${CAPTURE_MAX_BYTES}`,
    `- redactions: ${redacted.redactions}`,
    "",
    "````text",
    redacted.text.trimEnd(),
    "````",
    "",
  ].join("\n");
  await writeFile(tmpPath, body, { encoding: "utf8", mode: 0o600 });
  await rename(tmpPath, targetPath);
  return {
    pane,
    path: targetPath,
    bytes: Buffer.byteLength(body),
    redactions: redacted.redactions,
    captured_at: capturedAt,
  };
}

function selftest() {
  const sample = [
    "Authorization: Bearer abcdefghijklmnop",
    "API_KEY=super-secret-value",
    "github_pat_abcdefghijklmnopqrstuvwxyz",
    "https://user:password@example.invalid/path",
    '{"api_key":"json-secret-value-xyz"}',
    "OPENAI_API_KEY=openai-secret-value-xyz",
    "AWS_SECRET_ACCESS_KEY=aws-secret-value-xyz",
    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  ].join("\n");
  const result = redactCapture(sample);
  const leaked = /super-secret-value|abcdefghijklmnop|password@example|json-secret-value-xyz|openai-secret-value-xyz|aws-secret-value-xyz|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/.test(result.text);
  if (result.redactions < 8 || leaked) {
    throw new Error("capture redaction selftest failed");
  }
  const bounded = boundedTail(`a😀${"b".repeat(CAPTURE_MAX_BYTES - 2)}`);
  if (bounded.startsWith("�") || Buffer.byteLength(bounded) > CAPTURE_MAX_BYTES) {
    throw new Error("capture byte-cap selftest failed");
  }
  safePaneId("w3Q:p1");
  safePaneId("w57:pC");
  if (actionPaneTarget({ HERDR_PANE_ID: "w3Q:p2" }) !== "w3Q:p2" || actionPaneTarget({}) !== "") {
    throw new Error("capture action pane-context selftest failed");
  }
  const captureFixture = {
    panes: [
      { pane_id: "w3Q:p2", tab_id: "w3Q:t2", workspace_id: "w3Q", focused: true },
      { pane_id: "w3Q:p1", tab_id: "w3Q:t1", workspace_id: "w3Q", focused: false },
      { pane_id: "w9X:p1", tab_id: "w9X:t1", workspace_id: "w9X", focused: false },
    ],
    agents: [
      { pane_id: "w3Q:p1", tab_id: "w3Q:t1", workspace_id: "w3Q", agent_status: "done", state_change_seq: 20 },
      { pane_id: "w9X:p1", tab_id: "w9X:t1", workspace_id: "w9X", agent_status: "working", state_change_seq: 99 },
    ],
  };
  if (selectCaptureAgent(captureFixture, "w3Q:p2") !== "w3Q:p1") {
    throw new Error("capture workspace fallback selftest failed");
  }
  if (selectCaptureAgent(captureFixture, "w3Q:p1") !== "w3Q:p1") {
    throw new Error("capture direct-agent selftest failed");
  }
  try {
    safePaneId("../../bad");
    throw new Error("pane validation selftest failed");
  } catch (err) {
    if (err.message === "pane validation selftest failed") throw err;
  }
  return { ok: true, redactions: result.redactions, cap_bytes: CAPTURE_MAX_BYTES };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const READ_TOOLS = [
  {
    name: "herdr_snapshot",
    description:
      "Live Herdr snapshot: workspaces, tabs, panes and AI agents with ids, statuses and cwd. Call this first to discover target ids.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      const res = await herdr(["api", "snapshot"]);
      if (!res.ok) throw new Error(res.error || res.stderr);
      const s = JSON.parse(res.stdout)?.result?.snapshot ?? {};
      return {
        workspaces: (s.workspaces ?? []).map((w) => ({
          id: w.workspace_id, label: w.label, active_tab: w.active_tab_id,
          agent_status: w.agent_status,
        })),
        tabs: (s.tabs ?? []).map((t) => ({
          id: t.tab_id, workspace: t.workspace_id, label: t.label, agent_status: t.agent_status,
        })),
        panes: (s.panes ?? []).map((p) => ({
          id: p.pane_id, tab: p.tab_id, agent: p.agent, agent_status: p.agent_status,
          cwd: p.cwd, focused: p.focused,
        })),
        agents: (s.agents ?? []).map((a) => ({
          pane: a.pane_id, agent: a.agent, status: a.agent_status, cwd: a.cwd,
        })),
      };
    },
  },
  {
    name: "herdr_read_agent",
    description:
      "Read recent terminal output of one Herdr agent/pane. Use herdr_snapshot to find the pane or agent target.",
    inputSchema: {
      type: "object",
      required: ["target"],
      properties: {
        target: { type: "string", description: "Pane id (e.g. w3N:p4) or agent name" },
        source: {
          type: "string",
          enum: ["recent", "visible", "recent-unwrapped", "detection"],
          description: "Snapshot source (default recent)",
        },
      },
      additionalProperties: false,
    },
    async run({ target, source }) {
      const args = ["agent", "read", String(target)];
      if (source) args.push("--source", String(source));
      const res = await herdr(args);
      if (!res.ok) throw new Error(res.error || res.stderr || "read failed");
      return { output: res.stdout.trim().slice(0, 8000) };
    },
  },
];

const WRITE_TOOLS = [
  {
    name: "herdr_capture_agent",
    description:
      "Capture bounded, redacted recent output from a Herdr pane into the plugin export directory. Requires the bridge write gate.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Pane id such as w3Q:p1; omit to use the focused pane" },
      },
      additionalProperties: false,
    },
    async run({ target }) {
      return captureAgent(target ? String(target) : "");
    },
  },
  {
    name: "herdr_prompt_agent",
    description:
      "Submit a prompt to a running Herdr agent (claude/codex/opencode/…) in its pane. The agent starts working immediately.",
    inputSchema: {
      type: "object",
      required: ["target", "text"],
      properties: {
        target: { type: "string", description: "Pane id or agent name" },
        text: { type: "string", description: "Prompt text to submit" },
      },
      additionalProperties: false,
    },
    async run({ target, text }) {
      const res = await herdr(["agent", "prompt", String(target), String(text)]);
      if (!res.ok) throw new Error(res.error || res.stderr || "prompt failed");
      return { submitted: true, target, response: res.stdout.trim().slice(0, 2000) };
    },
  },
  {
    name: "herdr_notify",
    description: "Show a desktop notification through Herdr.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        message: { type: "string" },
      },
      additionalProperties: false,
    },
    async run({ title, message }) {
      const args = ["notification", "show", String(title)];
      if (message) args.push(String(message));
      const res = await herdr(args);
      if (!res.ok) throw new Error(res.error || res.stderr || "notify failed");
      return { notified: true };
    },
  },
];

const allTools = () => (allowWrite() ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS);

// ---------------------------------------------------------------------------
// JSON-RPC core
// ---------------------------------------------------------------------------

async function handleRpc(msg) {
  const { method, id, params } = msg;
  const reply = (result) => (id === undefined ? null : { jsonrpc: "2.0", id, result });
  const fail = (code, message) =>
    id === undefined ? null : { jsonrpc: "2.0", id, error: { code, message } };

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: NAME,
          version: VERSION,
          writeEnabled: allowWrite(),
        },
      });
    case "notifications/initialized":
      return reply({});
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: allTools().map(({ name, description, inputSchema }) => ({
          name, description, inputSchema,
        })),
      });
    case "tools/call": {
      const tool = allTools().find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `unknown tool: ${params?.name}`);
      try {
        const result = await tool.run(params?.arguments ?? {});
        return reply({
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        return reply({
          content: [{ type: "text", text: String(err?.message || err) }],
          isError: true,
        });
      }
    }
    default:
      return fail(-32601, `method not supported: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

function startHttp() {
  const port = Number(process.env.CHEF_CHATGPT_PORT || PORT_DEFAULT);
  const token = process.env.CHEF_CHATGPT_TOKEN || "";
  const bind = process.env.CHEF_CHATGPT_BIND || "127.0.0.1";
  const loopback = /^(127\.|::1$|localhost$)/.test(bind);
  // Non-loopback binds are only for the tunnel origin path — and must carry a token.
  if (!loopback && !token) {
    throw new Error(
      "refusing to bind non-loopback without CHEF_CHATGPT_TOKEN; set a token or keep 127.0.0.1",
    );
  }
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, name: NAME, version: VERSION, write: allowWrite() }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/mcp") {
      res.writeHead(405).end();
      return;
    }
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    let chunks = [];
    for await (const c of req) chunks.push(c);
    let msgs;
    try {
      msgs = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Array.isArray(msgs)) msgs = [msgs];
    } catch {
      res.writeHead(400).end();
      return;
    }
    const replies = [];
    for (const m of msgs) {
      const r = await handleRpc(m).catch((e) => ({
        jsonrpc: "2.0", id: m?.id ?? null,
        error: { code: -32603, message: String(e?.message || e) },
      }));
      if (r) replies.push(r);
    }
    // Batched requests get a JSON array; single requests answer inline (spec-compliant).
    const body = Array.isArray(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      ? JSON.stringify(replies)
      : JSON.stringify(replies[0] ?? {});
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bind, () => resolve(server));
  });
}

async function startStdio() {
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk.toString("utf8");
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const out = await handleRpc(msg).catch(() => null);
      if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
    }
  }
}

function bridgeStateDir() {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!dir) throw new Error("HERDR_PLUGIN_STATE_DIR is required");
  return dir;
}

function bridgePidPath(dir) {
  return path.join(dir, BRIDGE_PID_FILE);
}

async function readManagedPid(dir) {
  try {
    const pid = Number((await readFile(bridgePidPath(dir), "utf8")).trim());
    if (Number.isInteger(pid) && pid > 0) return pid;
    await unlink(bridgePidPath(dir)).catch(() => {});
    return null;
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

function bridgeEndpoint() {
  const bind = process.env.CHEF_CHATGPT_BIND || "127.0.0.1";
  const port = Number(process.env.CHEF_CHATGPT_PORT || PORT_DEFAULT);
  return { bind, port, url: `http://${bind}:${port}/mcp` };
}

async function bridgeHealth(timeoutMs = 600) {
  const { bind, port } = bridgeEndpoint();
  const host = bind === "0.0.0.0" ? "127.0.0.1" : bind === "::" ? "::1" : bind;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = http.get({ host, port, path: "/healthz" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          finish(res.statusCode === 200 && body?.ok === true && body?.name === NAME);
        } catch {
          finish(false);
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("health timeout")));
    req.on("error", () => finish(false));
  });
}

async function waitForBridgeHealth(timeoutMs = BRIDGE_START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await bridgeHealth()) return true;
    await new Promise((resolve) => setTimeout(resolve, 75));
  } while (Date.now() < deadline);
  return false;
}

async function serveForeground() {
  const dir = bridgeStateDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const server = await startHttp();
  await writeFile(bridgePidPath(dir), `${process.pid}\n`, { encoding: "utf8", mode: 0o600 });
  const addr = server.address();
  const cleanupAndExit = () => {
    server.close(() => {
      unlink(bridgePidPath(dir)).catch(() => {}).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 1_000).unref();
  };
  process.once("SIGTERM", cleanupAndExit);
  process.once("SIGINT", cleanupAndExit);
  console.log(JSON.stringify({
    ok: true,
    listening: `http://${addr.address}:${addr.port}/mcp`,
    pid: process.pid,
    managed: true,
  }));
}

async function serveManaged() {
  const dir = bridgeStateDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const existingPid = await readManagedPid(dir);
  if (existingPid && processAlive(existingPid)) {
    if (await bridgeHealth()) {
      console.log(JSON.stringify({
        ok: true,
        already_running: true,
        managed: true,
        pid: existingPid,
        listening: bridgeEndpoint().url,
      }));
      return;
    }
    throw new Error(`managed bridge pid ${existingPid} is alive but its health check failed`);
  }
  if (existingPid) await unlink(bridgePidPath(dir)).catch(() => {});
  if (await bridgeHealth()) {
    throw new Error("bridge endpoint is already occupied by an unmanaged bridge; stop it before starting a managed instance");
  }

  const child = spawn(process.execPath, [process.argv[1], "serve-foreground"], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  if (!(await waitForBridgeHealth())) {
    if (processAlive(child.pid)) process.kill(child.pid, "SIGTERM");
    throw new Error("managed bridge did not become healthy after start");
  }
  const pid = (await readManagedPid(dir)) || child.pid;
  console.log(JSON.stringify({
    ok: true,
    started: true,
    managed: true,
    pid,
    listening: bridgeEndpoint().url,
  }));
}

async function doctor() {
  const snap = await herdr(["api", "snapshot"]);
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  const managedPid = dir ? await readManagedPid(dir) : null;
  const running = await bridgeHealth();
  console.log(
    JSON.stringify(
      {
        ok: true,
        name: NAME,
        version: VERSION,
        bridge_running: running,
        managed_pid: managedPid && processAlive(managedPid) ? managedPid : null,
        endpoint: bridgeEndpoint().url,
        write_enabled: allowWrite(),
        token_required: Boolean(process.env.CHEF_CHATGPT_TOKEN),
        bind: process.env.CHEF_CHATGPT_BIND || "127.0.0.1",
        herdr_reachable: snap.ok,
        tools: allTools().map((t) => t.name),
        hint: allowWrite()
          ? "write tools enabled — keep CHEF_CHATGPT_TOKEN set when exposing beyond loopback"
          : "read-only; set CHEF_CHATGPT_ALLOW_WRITE=1 to add prompt/notify tools",
      },
      null,
      2,
    ),
  );
}

async function stop() {
  const dir = bridgeStateDir();
  const pid = await readManagedPid(dir);
  if (!pid) {
    console.log(JSON.stringify({ ok: true, stopped: null, note: "not running" }));
    return;
  }
  if (!processAlive(pid)) {
    await unlink(bridgePidPath(dir)).catch(() => {});
    console.log(JSON.stringify({ ok: true, stopped: null, stale_pid: pid, note: "not running" }));
    return;
  }
  if (!(await bridgeHealth())) {
    await unlink(bridgePidPath(dir)).catch(() => {});
    console.log(JSON.stringify({
      ok: true,
      stopped: null,
      stale_pid: pid,
      note: "pidfile did not point to a healthy ChatGPT bridge; process left untouched",
    }));
    return;
  }
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + 2_000;
  while (processAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await unlink(bridgePidPath(dir)).catch(() => {});
  console.log(JSON.stringify({ ok: true, stopped: pid, exited: !processAlive(pid) }));
}

async function main() {
  const mode = process.argv[2] || "doctor";
  switch (mode) {
    case "serve":
      await serveManaged();
      break;
    case "serve-foreground":
      await serveForeground();
      break;
    case "stdio":
      await startStdio();
      break;
    case "doctor":
      await doctor();
      break;
    case "capture-focused":
      console.log(JSON.stringify({
        ok: true,
        action: "capture-focused",
        ...(await captureAgent(actionPaneTarget())),
      }));
      break;
    case "selftest":
      console.log(JSON.stringify(selftest()));
      break;
    case "stop":
      await stop();
      break;
    default:
      console.error(`unknown mode: ${mode}`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exitCode = 1;
});
