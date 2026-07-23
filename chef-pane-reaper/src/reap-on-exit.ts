#!/usr/bin/env node
import { loadDotEnv, writeFragment, runReaper, reaperPath, isLiveMode, PLUGIN_ID } from "./common";

loadDotEnv();

function parseEvent() {
  try {
    return JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON || "{}");
  } catch {
    return {};
  }
}

async function main() {
  const event = parseEvent();
  const paneId =
    event?.pane_id ||
    event?.pane?.pane_id ||
    process.env.HERDR_PANE_ID ||
    "unknown";
  const dryRun = !isLiveMode();

  const result = runReaper(dryRun);
  const lines = result.output.split("\n").filter(Boolean);
  const data = {
    trigger: process.env.HERDR_PLUGIN_EVENT || "manual",
    pane_id: paneId,
    script: reaperPath(),
    dry_run: dryRun,
    ok: result.ok,
    exit_code: result.exitCode,
    lines_reported: lines.length,
    last_lines: lines.slice(-5),
  };

  const display = result.ok
    ? `Reaper ${dryRun ? "dry-run" : "live"} · ${lines.length} line(s) · pane ${String(paneId).slice(0, 12)}`
    : `Reaper failed: ${result.output.slice(0, 60)}`;

  writeFragment(data, display);
  console.log(`${PLUGIN_ID}: ${display}`);
  if (!result.ok) process.exitCode = 1;
}

main();
