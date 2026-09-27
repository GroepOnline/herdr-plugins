#!/usr/bin/env node
/**
 * com.chefgroep.herdr-board — read-only viewer for the opencode agent-board.
 *
 * Reads ~/.local/share/opencode/board/board.jsonl (JSONL entries:
 * {id, ts, updated, author, project, text, tag, status, note}).
 * NEVER writes: claim/post stays in opencode (/board command).
 *
 * Board path resolution (first hit wins):
 *   1. $HERDR_BOARD_PATH or $BOARD_PATH env
 *   2. <config-dir>/board-path  (plain text file, first line = path)
 *   3. <config-dir>/board.conf  (line BOARD_PATH=<path>)
 *   4. ~/.local/share/opencode/board/board.jsonl
 * Config dir: $HERDR_PLUGIN_CONFIG_DIR, else
 * ~/.config/herdr/plugins/com.chefgroep.herdr-board
 *
 * Usage: node src/board.js show | show-all | pane [--limit N]
 */
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PLUGIN_ID = "com.chefgroep.herdr-board";
const DEFAULT_BOARD = path.join(
  os.homedir(),
  ".local",
  "share",
  "opencode",
  "board",
  "board.jsonl",
);
const PREVIEW_LEN = 120;
const DEFAULT_LIMIT = 50;

const GLYPH = { open: "○", claimed: "◐", done: "●", wontdo: "✕" };

function configDir() {
  if (process.env.HERDR_PLUGIN_CONFIG_DIR) return process.env.HERDR_PLUGIN_CONFIG_DIR;
  return path.join(os.homedir(), ".config", "herdr", "plugins", PLUGIN_ID);
}

function parseBoardConf(text) {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = /^BOARD_PATH\s*=\s*(.+)$/.exec(t);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

async function resolveBoardPath() {
  if (process.env.HERDR_BOARD_PATH) return process.env.HERDR_BOARD_PATH;
  if (process.env.BOARD_PATH) return process.env.BOARD_PATH;
  const dir = configDir();
  try {
    const p = (await readFile(path.join(dir, "board-path"), "utf8")).split("\n")[0].trim();
    if (p) return p;
  } catch { /* not configured */ }
  try {
    const p = parseBoardConf(await readFile(path.join(dir, "board.conf"), "utf8"));
    if (p) return p;
  } catch { /* not configured */ }
  return DEFAULT_BOARD;
}

function oneLine(text, maxLen) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > maxLen ? `${flat.slice(0, maxLen - 1)}…` : flat;
}

function tsOf(entry) {
  const t = Date.parse(entry.ts ?? entry.updated ?? "");
  return Number.isNaN(t) ? 0 : t;
}

async function loadBoard(boardPath) {
  let raw;
  try {
    raw = await readFile(boardPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return { entries: [], skipped: 0, missing: true };
    throw err;
  }
  const entries = [];
  let skipped = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      skipped += 1;
    }
  }
  return { entries, skipped, missing: false };
}

function render(entries, { limit }) {
  const lines = [];
  const shown = entries.slice(0, limit);
  for (const e of shown) {
    const glyph = GLYPH[e.status] ?? "?";
    const id = e.id ?? "?";
    const tag = e.tag ?? "-";
    const author = e.author ?? "?";
    lines.push(`${glyph} ${id} [${tag}] ${author} — ${oneLine(e.text, PREVIEW_LEN)}`);
  }
  if (entries.length > shown.length) lines.push(`… +${entries.length - shown.length} more`);
  return lines;
}

function parseArgs(argv) {
  let limit = DEFAULT_LIMIT;
  const li = argv.indexOf("--limit");
  if (li !== -1) {
    const n = Number(argv[li + 1]);
    if (Number.isInteger(n) && n > 0) limit = n;
  }
  return { limit };
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (!["show", "show-all", "pane"].includes(mode)) {
    console.error("usage: board.js show | show-all | pane [--limit N]");
    process.exit(2);
  }
  const { limit } = parseArgs(rest);
  const boardPath = await resolveBoardPath();
  const { entries, skipped, missing } = await loadBoard(boardPath);

  if (missing) {
    console.log(`agent-board: no board file at ${boardPath} (set HERDR_BOARD_PATH or <config-dir>/board-path)`);
    return;
  }

  const filtered =
    mode === "show-all"
      ? entries
      : entries.filter((e) => e.status === "open" || e.status === "claimed");
  filtered.sort((a, b) => tsOf(b) - tsOf(a));

  const scope = mode === "show-all" ? "all" : "open/claimed";
  console.log(`agent-board [${scope}] — ${filtered.length}/${entries.length} items — ${boardPath}`);
  for (const line of render(filtered, { limit })) console.log(line);
  if (skipped > 0) console.log(`(!) skipped ${skipped} malformed line(s)`);

  if (mode === "pane") {
    // Keep the pane alive and refresh on change (poll: cheap, works over SSHFS/NFS).
    let lastMtime = 0;
    try {
      lastMtime = (await stat(boardPath)).mtimeMs;
    } catch { /* ignore */ }
    setInterval(async () => {
      let mtime = 0;
      try {
        mtime = (await stat(boardPath)).mtimeMs;
      } catch { return; }
      if (mtime === lastMtime) return;
      lastMtime = mtime;
      const re = await loadBoard(boardPath);
      const list =
        mode === "show-all"
          ? re.entries
          : re.entries.filter((e) => e.status === "open" || e.status === "claimed");
      list.sort((a, b) => tsOf(b) - tsOf(a));
      console.log(`\n--- refresh ${new Date().toISOString()} — ${list.length}/${re.entries.length} items ---`);
      for (const line of render(list, { limit })) console.log(line);
    }, 15_000);
    await new Promise(() => {}); // run until killed
  }
}

main().catch((err) => {
  console.error(`agent-board error: ${err.message}`);
  process.exit(1);
});
