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
import { execFile } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";

const NAME = "herdr-chatgpt-bridge";
const VERSION = "0.1.0";
const PROTOCOL_VERSION = "2025-06-18";
const PORT_DEFAULT = 8791;
const CMD_TIMEOUT_MS = 20_000;

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

async function doctor() {
  const snap = await herdr(["api", "snapshot"]);
  console.log(
    JSON.stringify(
      {
        ok: true,
        name: NAME,
        version: VERSION,
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
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!dir) throw new Error("HERDR_PLUGIN_STATE_DIR is required");
  try {
    const pid = Number((await readFile(path.join(dir, "chatgpt-bridge.pid"), "utf8")).trim());
    if (Number.isFinite(pid)) process.kill(pid, "SIGTERM");
    await unlink(path.join(dir, "chatgpt-bridge.pid")).catch(() => {});
    console.log(JSON.stringify({ ok: true, stopped: pid }));
  } catch (err) {
    if (err?.code === "ENOENT") {
      console.log(JSON.stringify({ ok: true, stopped: null, note: "not running" }));
      return;
    }
    throw err;
  }
}

async function main() {
  const mode = process.argv[2] || "doctor";
  switch (mode) {
    case "serve": {
      const server = await startHttp();
      const port = server.address().port;
      const dir = process.env.HERDR_PLUGIN_STATE_DIR;
      if (dir) {
        await mkdir(dir, { recursive: true }).catch(() => {});
        await writeFile(path.join(dir, "chatgpt-bridge.pid"), `${process.pid}\n`).catch(() => {});
      }
      const addr = server.address();
      console.log(JSON.stringify({ ok: true, listening: `http://${addr.address}:${addr.port}/mcp`, pid: process.pid }));
      break;
    }
    case "stdio":
      await startStdio();
      break;
    case "doctor":
      await doctor();
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
