import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

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
export const PLUGIN_ID = "com.chefgroep.pane-reaper";
const DEFAULT_REAPER = path.join(process.env.HOME || os.homedir() || "/tmp", ".cursor/hooks/ghost-reaper.sh");

function ensurePrivateDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* ignore on platforms without chmod support */
  }
}

function expandHome(value: string): string {
  if (value.startsWith("~/")) return path.join(process.env.HOME || os.homedir() || "/tmp", value.slice(2));
  return value;
}

export function loadDotEnv() {
  if (!CONFIG_DIR) return;
  const p = path.join(CONFIG_DIR, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

export function writeFragment(data: unknown, display: string) {
  const stateDir = getStateDir();
  ensurePrivateDir(stateDir);
  const fragment = {
    plugin_id: PLUGIN_ID,
    component: "pane-reaper",
    data,
    fetched_at: Date.now(),
    ttl_seconds: 300,
    display,
  };
  const target = path.join(stateDir, "pane-reaper.json");
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(fragment), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function reaperPath(): string {
  return expandHome(process.env.GHOST_REAPER_SCRIPT || DEFAULT_REAPER).trim();
}

export function isLiveMode(raw = process.env.REAPER_LIVE): boolean {
  return (raw || "").trim() === "1";
}

export function runReaper(dryRun: boolean): { ok: boolean; output: string; exitCode: number | null } {
  const script = reaperPath();
  if (!fs.existsSync(script)) {
    return { ok: false, output: `ghost-reaper not found: ${script}`, exitCode: null };
  }
  const args = dryRun ? ["--dry-run"] : [];
  try {
    const output = execFileSync("bash", [script, ...args], {
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 1024 * 512,
    });
    return { ok: true, output: output.trim(), exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    const output = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim();
    return { ok: false, output, exitCode: e.status ?? 1 };
  }
}
