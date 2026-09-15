#!/usr/bin/env node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  attemptDelivery,
  buildMessage,
  configDigest,
  identityMatches,
  inspectComposer,
  newState,
  processEvents,
  recoverInterruptedDelivery,
  releaseAmbiguous,
  transitionMode,
  validateConfig,
  verifyRegistration,
} from "./lib.js";

const execFileAsync = promisify(execFile);
const STATE_FILE = "dispatch-state.json";
const TEAM_FILE = "team.json";
const LOCK_STALE_MS = 60_000;

function requiredDir(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stateDir() {
  return requiredDir("HERDR_PLUGIN_STATE_DIR");
}

function configPath() {
  return process.env.HERDR_DIRIGENT_CONFIG || path.join(requiredDir("HERDR_PLUGIN_CONFIG_DIR"), TEAM_FILE);
}

function statePath() {
  return path.join(stateDir(), STATE_FILE);
}

async function ensurePrivateDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
}

async function loadConfig(optional = false) {
  const config = await readJson(configPath(), null);
  if (config === null && optional) return null;
  return validateConfig(config);
}

async function loadState() {
  return { ...newState(), ...(await readJson(statePath(), newState())) };
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function reapAbandonedLock(lock) {
  const ownerPath = path.join(lock, "owner.json");
  const owner = await readJson(ownerPath, null).catch(() => null);
  if (Number.isInteger(owner?.pid) && owner.pid > 0 && processIsAlive(owner.pid)) return false;
  const age = Date.now() - (await stat(lock).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
  if (!owner && age <= LOCK_STALE_MS) return false;
  const current = await readJson(ownerPath, null).catch(() => null);
  if (owner?.token && current?.token !== owner.token) return false;
  await rm(lock, { recursive: true, force: true });
  return true;
}

export async function acquireLock(name, waitMs = 0) {
  const lock = path.join(stateDir(), name);
  await ensurePrivateDir(stateDir());
  const deadline = Date.now() + waitMs;
  for (;;) {
    const token = randomUUID();
    try {
      await mkdir(lock, { mode: 0o700 });
      await writeJson(path.join(lock, "owner.json"), { token, pid: process.pid, created_at: Date.now() });
      return { path: lock, token };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await reapAbandonedLock(lock)) continue;
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

export async function releaseLock(lease) {
  if (!lease) return;
  const owner = await readJson(path.join(lease.path, "owner.json"), null).catch(() => null);
  if (owner?.token === lease.token) await rm(lease.path, { recursive: true, force: true });
}

async function withLock(fn, waitMs = 5000) {
  const lease = await acquireLock("dispatch.lock", waitMs);
  if (!lease) throw new Error("dispatch is busy");
  try {
    return await fn();
  } finally {
    await releaseLock(lease);
  }
}

function parseCliJson(stdout, stderr, context) {
  const text = String(stdout || "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${context}: ${String(stderr || text || "invalid Herdr response").trim()}`);
  }
  if (parsed.error) throw new Error(`${parsed.error.code}: ${parsed.error.message}`);
  return parsed;
}

function createHerdrClient() {
  const bin = process.env.HERDR_BIN_PATH || "herdr";
  async function run(args) {
    try {
      const result = await execFileAsync(bin, args, { timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true });
      return parseCliJson(result.stdout, result.stderr, args.join(" "));
    } catch (error) {
      if (error?.stdout) return parseCliJson(error.stdout, error.stderr, args.join(" "));
      throw error;
    }
  }
  return {
    async getAgent(target) {
      return (await run(["agent", "get", target])).result.agent;
    },
    async getPane(target) {
      return (await run(["pane", "get", target])).result.pane;
    },
    async readAgent(target) {
      const result = await execFileAsync(bin, ["agent", "read", target, "--source", "detection", "--lines", "30", "--format", "text"], {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      return result.stdout;
    },
    async promptAgent(target, text) {
      const response = await run(["agent", "prompt", target, text]);
      if (response?.result?.type !== "agent_prompted") throw new Error("Herdr did not confirm agent_prompted");
      return response.result;
    },
  };
}

function normalizeEvent(raw, name) {
  if (raw && typeof raw === "object") return raw;
  return { event: String(name || "").replaceAll(".", "_"), data: {} };
}

async function spoolEvent() {
  const raw = process.env.HERDR_PLUGIN_EVENT_JSON;
  if (!raw) throw new Error("HERDR_PLUGIN_EVENT_JSON is required for event hooks");
  const envelope = normalizeEvent(JSON.parse(raw), process.env.HERDR_PLUGIN_EVENT);
  const inbox = path.join(stateDir(), "inbox");
  await ensurePrivateDir(inbox);
  const file = path.join(inbox, `${Date.now()}-${process.pid}-${randomUUID()}.json`);
  await writeJson(file, envelope);
  return file;
}

async function drainEvents() {
  const inbox = path.join(stateDir(), "inbox");
  const names = await readdir(inbox).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
  const events = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(inbox, name);
    try {
      events.push(JSON.parse(await readFile(file, "utf8")));
    } finally {
      await unlink(file).catch(() => {});
    }
  }
  return events;
}

async function inboxHasEvents() {
  return (await readdir(path.join(stateDir(), "inbox")).catch(() => [])).some((name) => name.endsWith(".json"));
}

async function processCycle(client, coalesceMs = 0) {
  if (coalesceMs) await new Promise((resolve) => setTimeout(resolve, coalesceMs));
  const config = await loadConfig();
  const state = await loadState();
  recoverInterruptedDelivery(state);
  if (state.mode === "running" && state.config_digest !== configDigest(config)) {
    state.last_result = { result: "blocked", reason: "config_changed_requires_start", at: new Date().toISOString() };
    await writeJson(statePath(), state);
    await drainEvents();
    return state.last_result;
  }
  const events = await drainEvents();
  const outcomes = await processEvents(config, state, events, client, process.env.HERDR_PLUGIN_EVENT);
  await writeJson(statePath(), state);
  const delivery = await attemptDelivery(config, state, client, (next) => writeJson(statePath(), next));
  return { outcomes, delivery, pending: state.pending.length };
}

async function runEvent(client) {
  const config = await loadConfig(true);
  if (!config) return { result: "ignored", reason: "unconfigured" };
  await spoolEvent();
  let lease = await acquireLock("dispatch.lock", 15_000);
  if (!lease) return { result: "queued_for_next_dispatch" };
  let result = { result: "coalesced" };
  for (;;) {
    try {
      if (await inboxHasEvents()) result = await processCycle(client, config.delivery.coalesce_ms ?? 250);
    } finally {
      await releaseLock(lease);
    }
    if (!(await inboxHasEvents())) break;
    lease = await acquireLock("dispatch.lock", 0);
    if (!lease) break;
  }
  return result;
}

async function status() {
  const state = await loadState();
  return { ...state, config_path: configPath(), state_path: statePath() };
}

async function preview(client) {
  const config = await loadConfig();
  const state = await loadState();
  const live = await verifyRegistration(config, client);
  const director = live[0];
  const screen = await client.readAgent(director.pane_id);
  return {
    ok: true,
    campaign: config.campaign,
    owner: config.owner,
    delivery_mode: config.delivery.mode,
    members: live.map((member) => ({ pane_id: member.pane_id, terminal_id: member.terminal_id, agent: member.agent, status: member.agent_status })),
    director_input: inspectComposer(config.director.adapter, screen),
    pending: state.pending.length,
    message: state.pending.length ? buildMessage(config, state.pending) : null,
  };
}

async function start(client) {
  const config = await loadConfig();
  const verified = await verifyRegistration(config, client);
  let state = await loadState();
  const digest = configDigest(config);
  if (state.config_digest && state.config_digest !== digest) state = newState();
  state.mode = "running";
  state.config_digest = digest;
  state.last_result = { result: "started", delivery_mode: config.delivery.mode, at: new Date().toISOString() };
  for (let index = 0; index < verified.length; index += 1) {
    const member = index === 0 ? config.director : config.workers[index - 1];
    const live = verified[index];
    state.members[member.terminal_id] = {
      name: member.name,
      pane_id: live.pane_id,
      agent: live.agent || null,
      agent_session: live.agent_session || null,
      state_change_seq: Number(live.state_change_seq || 0),
      verified_at: new Date().toISOString(),
    };
  }
  await writeJson(statePath(), state);
  return state.last_result;
}

async function setMode(mode) {
  const state = transitionMode(await loadState(), mode);
  await writeJson(statePath(), state);
  return state.last_result;
}

async function resume(client) {
  const config = await loadConfig();
  const state = await loadState();
  if (state.config_digest !== configDigest(config)) throw new Error("config changed; use start to register identities again");
  await verifyRegistration(config, client);
  transitionMode(state, "running");
  await writeJson(statePath(), state);
  return attemptDelivery(config, state, client, (next) => writeJson(statePath(), next));
}

async function retryAmbiguous(client) {
  const config = await loadConfig();
  const state = await loadState();
  const released = releaseAmbiguous(state);
  await writeJson(statePath(), state);
  const delivery = await attemptDelivery(config, state, client, (next) => writeJson(statePath(), next));
  return { released, delivery };
}

async function startup(client) {
  const state = await loadState();
  const recovered = recoverInterruptedDelivery(state);
  await writeJson(statePath(), state);
  if (state.mode !== "running") return { result: "inert", mode: state.mode, recovered };
  const config = await loadConfig();
  if (state.config_digest !== configDigest(config)) return { result: "blocked", reason: "config_changed_requires_start", recovered };
  const delivery = await attemptDelivery(config, state, client, (next) => writeJson(statePath(), next));
  return { result: "startup", recovered, delivery };
}

async function main() {
  const action = process.argv[2] || "status";
  const client = createHerdrClient();
  let result;
  if (action === "event") result = await runEvent(client);
  else result = await withLock(async () => {
    if (action === "status") return status();
    if (action === "preview") return preview(client);
    if (action === "start") return start(client);
    if (action === "pause") return setMode("paused");
    if (action === "resume") return resume(client);
    if (action === "stop") return setMode("stopped");
    if (action === "retry-ambiguous") return retryAmbiguous(client);
    if (action === "startup") return startup(client);
    throw new Error(`unknown action: ${action}`);
  });
  console.log(JSON.stringify({ ok: true, action, ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }));
    process.exitCode = 1;
  });
}
