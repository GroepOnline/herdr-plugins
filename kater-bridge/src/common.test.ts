import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";

const stateDirs: string[] = [];

afterEach(() => {
  for (const dir of stateDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.HERDR_PLUGIN_STATE_DIR;
});

test("reclaims a dead lock before writing the merged fragment", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "kater-bridge-test-"));
  stateDirs.push(stateDir);
  process.env.HERDR_PLUGIN_STATE_DIR = stateDir;

  const lockPath = path.join(stateDir, ".fleet_ops.lock");
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 99999999, token: "dead-owner" }));

  const { writeFragment } = require("./common.js");
  writeFragment("test", "kater", { ok: true });

  const state = JSON.parse(fs.readFileSync(path.join(stateDir, "fleet_ops.json"), "utf8"));
  assert.equal(state.components.kater.plugin_id, "test");
  assert.equal(fs.existsSync(lockPath), false);
});

test("reclaims an ownerless stale initialization lock", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "kater-bridge-test-"));
  stateDirs.push(stateDir);
  process.env.HERDR_PLUGIN_STATE_DIR = stateDir;

  const lockPath = path.join(stateDir, ".fleet_ops.lock");
  fs.mkdirSync(lockPath);
  const old = new Date(Date.now() - 11000);
  fs.utimesSync(lockPath, old, old);

  const { writeFragment } = require("./common.js");
  writeFragment("test", "ownerless", { ok: true });
  assert.equal(fs.existsSync(lockPath), false);
});

test("reclaims a malformed stale initialization lock", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "kater-bridge-test-"));
  stateDirs.push(stateDir);
  process.env.HERDR_PLUGIN_STATE_DIR = stateDir;

  const lockPath = path.join(stateDir, ".fleet_ops.lock");
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, "owner.json"), "{}");
  const old = new Date(Date.now() - 11000);
  fs.utimesSync(lockPath, old, old);

  const { writeFragment } = require("./common.js");
  writeFragment("test", "malformed", { ok: true });
  assert.equal(fs.existsSync(lockPath), false);
});

test("does not reclaim a fresh ownerless initialization lock", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "kater-bridge-test-"));
  stateDirs.push(stateDir);
  process.env.HERDR_PLUGIN_STATE_DIR = stateDir;

  const lockPath = path.join(stateDir, ".fleet_ops.lock");
  fs.mkdirSync(lockPath);

  const { writeFragment } = require("./common.js");
  assert.throws(() => writeFragment("test", "fresh", { ok: true }), /timed out waiting/);
  assert.equal(fs.existsSync(lockPath), true);
});

test("katerAuthHeaders sends Bearer only when a key is provisioned", () => {
  const { katerAuthHeaders } = require("./common.js");
  const prev = process.env.KATER_API_KEY;
  delete process.env.KATER_API_KEY;
  try {
    assert.deepEqual(katerAuthHeaders(), {});
    process.env.KATER_API_KEY = "test-key";
    assert.deepEqual(katerAuthHeaders(), { Authorization: "Bearer test-key" });
    process.env.KATER_API_KEY = "bad\r\nheader";
    assert.throws(() => katerAuthHeaders(), /Invalid KATER_API_KEY/);
  } finally {
    if (prev === undefined) delete process.env.KATER_API_KEY;
    else process.env.KATER_API_KEY = prev;
  }
});

test("katerAuthHeaders refuses plaintext HTTP key disclosure to remote hosts", () => {
  const { katerAuthHeaders } = require("./common.js");
  const prev = process.env.KATER_API_KEY;
  process.env.KATER_API_KEY = "test-key";
  try {
    // Loopback HTTP stays allowed (default gateway, no network exposure).
    assert.deepEqual(katerAuthHeaders("http://127.0.0.1:9091/health"), {
      Authorization: "Bearer test-key",
    });
    assert.deepEqual(katerAuthHeaders("http://localhost:9090/sse"), {
      Authorization: "Bearer test-key",
    });
    // HTTPS always allowed.
    assert.deepEqual(katerAuthHeaders("https://gateway.example.com/sse"), {
      Authorization: "Bearer test-key",
    });
    // Remote plaintext HTTP must fail closed.
    assert.throws(() => katerAuthHeaders("http://gateway.example.com/sse"), /plaintext HTTP/);
    assert.throws(() => katerAuthHeaders("http://192.168.1.10:9091/health"), /plaintext HTTP/);
  } finally {
    if (prev === undefined) delete process.env.KATER_API_KEY;
    else process.env.KATER_API_KEY = prev;
  }
});

test("katerAuthHeaders without key never throws on remote HTTP", () => {
  const { katerAuthHeaders } = require("./common.js");
  const prev = process.env.KATER_API_KEY;
  delete process.env.KATER_API_KEY;
  try {
    assert.deepEqual(katerAuthHeaders("http://gateway.example.com/sse"), {});
  } finally {
    if (prev === undefined) delete process.env.KATER_API_KEY;
    else process.env.KATER_API_KEY = prev;
  }
});

test("katerCallTool resolves null instead of rejecting on invalid KATER_API_URL", async () => {
  const { katerCallTool } = require("./mcp.js");
  const prevUrl = process.env.KATER_API_URL;
  const prevMcp = process.env.KATER_MCP_URL;
  const prevKey = process.env.KATER_API_KEY;
  // Tab is non-printable, so katerApiUrl() throws before any network access.
  process.env.KATER_API_URL = "http://127.0.0.1:9091\t";
  delete process.env.KATER_MCP_URL;
  process.env.KATER_API_KEY = "test-key";
  try {
    assert.equal(await katerCallTool("utrecht_fleet_inventory", {}), null);
  } finally {
    if (prevUrl === undefined) delete process.env.KATER_API_URL;
    else process.env.KATER_API_URL = prevUrl;
    if (prevMcp === undefined) delete process.env.KATER_MCP_URL;
    else process.env.KATER_MCP_URL = prevMcp;
    if (prevKey === undefined) delete process.env.KATER_API_KEY;
    else process.env.KATER_API_KEY = prevKey;
  }
});

test("katerCallTool fails fast when the TLS guard refuses a remote plaintext MCP URL", async () => {
  const { katerCallTool } = require("./mcp.js");
  const prevMcp = process.env.KATER_MCP_URL;
  const prevKey = process.env.KATER_API_KEY;
  process.env.KATER_MCP_URL = "http://192.0.2.1:9089"; // TEST-NET-1, unroutable
  process.env.KATER_API_KEY = "test-key";
  try {
    const started = Date.now();
    assert.equal(await katerCallTool("utrecht_fleet_inventory", {}), null);
    // Refused at transport construction; a real connect attempt would take ~15s.
    assert.ok(Date.now() - started < 5000, "TLS guard should refuse before connecting");
  } finally {
    if (prevMcp === undefined) delete process.env.KATER_MCP_URL;
    else process.env.KATER_MCP_URL = prevMcp;
    if (prevKey === undefined) delete process.env.KATER_API_KEY;
    else process.env.KATER_API_KEY = prevKey;
  }
});
