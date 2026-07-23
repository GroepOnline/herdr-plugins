import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export const STATE_DIR = process.env.HERDR_PLUGIN_STATE_DIR || "/tmp/herdr-plugin-state";
export const CONFIG_DIR = process.env.HERDR_PLUGIN_CONFIG_DIR || "";
export const KATER_API_URL = (process.env.KATER_API_URL || "http://127.0.0.1:9091").replace(/\/$/, "");
export const PLUGIN_ID = "com.chefgroep.kater-bridge";

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

export function writeFragment(pluginId: string, component: string, data: unknown, ttlSeconds = 60, display = "") {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const fragment: Record<string, unknown> = {
    plugin_id: pluginId,
    component,
    data,
    fetched_at: Date.now(),
    ttl_seconds: ttlSeconds,
  };
  if (display) fragment.display = display;
  fs.writeFileSync(path.join(STATE_DIR, "fleet_ops.json"), JSON.stringify(fragment));
  return fragment;
}

export function cacheGet(key: string) {
  try {
    const p = path.join(STATE_DIR, "cache", key + ".json");
    if (!fs.existsSync(p)) return null;
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    if (obj.expires_at && Date.now() > obj.expires_at) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
      return null;
    }
    return obj.value;
  } catch {
    return null;
  }
}

export function cacheSet(key: string, value: unknown, ttlSeconds = 60) {
  try {
    const dir = path.join(STATE_DIR, "cache");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, key + ".json"),
      JSON.stringify({ expires_at: Date.now() + ttlSeconds * 1000, value }),
    );
  } catch { /* ignore */ }
}

export function git(cmd: string) {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export async function katerGet<T = unknown>(path: string, ttlSeconds = 0): Promise<T | null> {
  const cacheKey = `kater:${path}`;
  if (ttlSeconds > 0) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached as T;
  }
  try {
    const res = await fetch(`${KATER_API_URL}${path}`);
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    if (ttlSeconds > 0) cacheSet(cacheKey, data, ttlSeconds);
    return data;
  } catch {
    return null;
  }
}

export async function katerFetch<T = Record<string, unknown>>(
  path: string,
  ttlSeconds = 0,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const cacheKey = `kater:raw:${path}`;
  if (ttlSeconds > 0) {
    const cached = cacheGet(cacheKey) as { ok: boolean; status: number; data: T } | null;
    if (cached) return cached;
  }
  try {
    const res = await fetch(`${KATER_API_URL}${path}`);
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
