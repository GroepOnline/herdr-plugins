import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";

const FETCH_TIMEOUT_MS = 15000;

function resolveStateDir(): string {
  if (process.env.HERDR_PLUGIN_STATE_DIR) return process.env.HERDR_PLUGIN_STATE_DIR;
  const home = process.env.HOME || os.homedir();
  if (!home) throw new Error("HERDR_PLUGIN_STATE_DIR must be set when HOME is unavailable");
  return path.join(home, ".local", "state", "herdr-plugins");
}

export function getStateDir(): string {
  return resolveStateDir();
}

export const CONFIG_DIR = process.env.HERDR_PLUGIN_CONFIG_DIR || "";
export const PLUGIN_ID = "com.chefgroep.kater-bridge";

export function katerApiUrl(): string {
  return (process.env.KATER_API_URL || "http://127.0.0.1:9091").replace(/\/$/, "");
}

export function loadDotEnv() {
  if (!CONFIG_DIR) return;
  const p = path.join(CONFIG_DIR, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function ensurePrivateDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* ignore */
  }
}

export function writeFragment(pluginId: string, component: string, data: unknown, ttlSeconds = 60, display = "") {
  const stateDir = getStateDir();
  ensurePrivateDir(stateDir);
  const fragment: Record<string, unknown> = {
    plugin_id: pluginId,
    component,
    data,
    fetched_at: Date.now(),
    ttl_seconds: ttlSeconds,
  };
  if (display) fragment.display = display;

  const componentPath = path.join(stateDir, `${component}.json`);
  const componentTmp = componentPath + ".tmp";
  fs.writeFileSync(componentTmp, JSON.stringify(fragment), { mode: 0o600 });
  fs.renameSync(componentTmp, componentPath);

  const fleetOpsPath = path.join(stateDir, "fleet_ops.json");
  let merged: { components: Record<string, unknown>; updated_at?: number } = { components: {} };
  try {
    if (fs.existsSync(fleetOpsPath)) {
      const existing = JSON.parse(fs.readFileSync(fleetOpsPath, "utf8"));
      if (existing?.components && typeof existing.components === "object") merged = existing;
    }
  } catch {
    /* start fresh */
  }
  merged.components[component] = fragment;
  merged.updated_at = Date.now();
  const fleetTmp = fleetOpsPath + ".tmp";
  fs.writeFileSync(fleetTmp, JSON.stringify(merged), { mode: 0o600 });
  fs.renameSync(fleetTmp, fleetOpsPath);
  return fragment;
}

export function cacheGet(key: string) {
  try {
    const p = path.join(getStateDir(), "cache", key + ".json");
    if (!fs.existsSync(p)) return null;
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    if (obj.expires_at && Date.now() > obj.expires_at) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
      return null;
    }
    return obj.value;
  } catch {
    return null;
  }
}

export function cacheSet(key: string, value: unknown, ttlSeconds = 60) {
  try {
    const dir = path.join(getStateDir(), "cache");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, key + ".json"),
      JSON.stringify({ expires_at: Date.now() + ttlSeconds * 1000, value }),
    );
  } catch {
    /* ignore */
  }
}

export function git(cmd: string) {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function katerGet<T = unknown>(pathSuffix: string, ttlSeconds = 0): Promise<T | null> {
  const cacheKey = `kater:${pathSuffix}`;
  if (ttlSeconds > 0) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached as T;
  }
  try {
    const res = await fetchWithTimeout(`${katerApiUrl()}${pathSuffix}`);
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    if (ttlSeconds > 0) cacheSet(cacheKey, data, ttlSeconds);
    return data;
  } catch {
    return null;
  }
}

export async function katerFetch<T = Record<string, unknown>>(
  pathSuffix: string,
  ttlSeconds = 0,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const cacheKey = `kater:raw:${pathSuffix}`;
  if (ttlSeconds > 0) {
    const cached = cacheGet(cacheKey) as { ok: boolean; status: number; data: T } | null;
    if (cached) return cached;
  }
  try {
    const res = await fetchWithTimeout(`${katerApiUrl()}${pathSuffix}`);
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    const result = { ok: res.ok, status: res.status, data };
    if (ttlSeconds > 0 && res.ok) cacheSet(cacheKey, result, ttlSeconds);
    return result;
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

type FleetNode = { name?: string; hostname?: string; status?: string; roles?: string[]; role?: string };
type FleetInventory = {
  nodes?: FleetNode[];
  node_count?: number;
  status_counts?: Record<string, number>;
};

export function summarizeFleet(inventory: FleetInventory | null) {
  const nodes = inventory?.nodes || [];
  const okCount = inventory?.status_counts?.ok ?? nodes.filter(n => (n.status || "").toLowerCase() === "ok").length;
  const decommissioned =
    inventory?.status_counts?.decommissioned ??
    nodes.filter(n => (n.status || "").toLowerCase() === "decommissioned").length;
  const total = inventory?.node_count ?? nodes.length;
  return {
    node_count: total,
    ok: okCount,
    decommissioned,
    nodes: nodes.slice(0, 12).map(n => ({
      name: n.hostname || n.name,
      status: n.status,
      role: n.role || (n.roles || []).join(", "),
    })),
  };
}

export function summarizeDoctor(findings: Array<{ severity?: string; message?: string }> = []) {
  const counts = { error: 0, warning: 0, info: 0, other: 0 };
  for (const f of findings) {
    const sev = (f.severity || "other").toLowerCase();
    if (sev in counts) counts[sev as keyof typeof counts] += 1;
    else counts.other += 1;
  }
  const top = findings.slice(0, 3).map(f => f.message).filter(Boolean);
  return { counts, top_messages: top };
}

export function findingSeverity(finding: { severity?: string }): string {
  return (finding.severity || "").toLowerCase();
}
