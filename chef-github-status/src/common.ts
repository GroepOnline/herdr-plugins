import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

export const STATE_DIR = process.env.HERDR_PLUGIN_STATE_DIR || "/tmp/herdr-plugin-state";
export const CONFIG_DIR = process.env.HERDR_PLUGIN_CONFIG_DIR || "";

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

export function pluginContext(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }
  catch { return {}; }
}

export function contextCwd(): string {
  const ctx = pluginContext();
  for (const candidate of [ctx.focused_pane_cwd, ctx.workspace_cwd, process.cwd()]) {
    if (typeof candidate === "string" && candidate && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  return process.cwd();
}

export function git(args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: contextCwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return ""; }
}

export function githubRepoFromRemote(remote: string): { owner: string; repo: string } | null {
  const value = (remote || "").trim().replace(/\.git$/, "");
  if (!value) return null;
  const scp = value.match(/^[^@\s]+@github\.com:([^/\s]+)\/([^/\s]+)$/);
  if (scp) return { owner: scp[1], repo: scp[2] };
  try {
    const u = new URL(value);
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length === 2) return { owner: parts[0], repo: parts[1] };
  } catch { /* not a URL */ }
  return null;
}

export function writeFragment(pluginId, component, data, ttlSeconds = 60, display = "") {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const fragment: any = { plugin_id: pluginId, component, data, fetched_at: Date.now(), ttl_seconds: ttlSeconds };
  if (display) fragment.display = display;
  const target = path.join(STATE_DIR, "fleet_ops.json");
  const tmp = path.join(STATE_DIR, `fleet_ops.json.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(fragment), { mode: 0o600 });
  fs.renameSync(tmp, target);
  return fragment;
}

export function cacheGet(key) {
  try {
    const p = path.join(STATE_DIR, "cache", key + ".json");
    if (!fs.existsSync(p)) return null;
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    if (obj.expires_at && Date.now() > obj.expires_at) { try { fs.unlinkSync(p); } catch {} return null; }
    return obj.value;
  } catch { return null; }
}

export function cacheSet(key, value, ttlSeconds = 60) {
  try {
    const dir = path.join(STATE_DIR, "cache");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, key + ".json"), JSON.stringify({ expires_at: Date.now() + ttlSeconds * 1000, value }));
  } catch {}
}

export function getToken(name, alt = "") {
  return (process.env[name] || (alt ? process.env[alt] : "") || "").trim();
}
