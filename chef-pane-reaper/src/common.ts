import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

export const STATE_DIR = process.env.HERDR_PLUGIN_STATE_DIR || "/tmp/herdr-plugin-state";
export const CONFIG_DIR = process.env.HERDR_PLUGIN_CONFIG_DIR || "";
export const PLUGIN_ID = "com.chefgroep.pane-reaper";
const DEFAULT_REAPER = path.join(process.env.HOME || "/tmp", ".cursor/hooks/ghost-reaper.sh");

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
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(STATE_DIR, "fleet_ops.json"),
    JSON.stringify({
      plugin_id: PLUGIN_ID,
      component: "pane-reaper",
      data,
      fetched_at: Date.now(),
      ttl_seconds: 300,
      display,
    }),
  );
}

export function reaperPath(): string {
  return (process.env.GHOST_REAPER_SCRIPT || DEFAULT_REAPER).trim();
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
