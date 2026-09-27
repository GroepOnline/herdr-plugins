---
name: pane-reaper
description: Clean orphaned agent/MCP processes on herdr pane exit (dry-run by default). Use when agent panes leave processes behind.
---

# pane-reaper

Runs the ghost-reaper script on `pane.exited` to reap orphaned agent/MCP
processes (the ~2GB MCP-bloat class of problems).

## Safety (default = dry-run)

- Without `GHOST_REAPER_SCRIPT` in the plugin `.env`: graceful
  "ghost-reaper not found", nothing happens.
- Live reaping ONLY with `REAPER_LIVE=1` in the plugin config env.
- Default script path: `~/.cursor/hooks/ghost-reaper.sh` (override via
  `GHOST_REAPER_SCRIPT`).

## Enable live mode

1. Provide a reaper script (writes nothing itself in dry-run; logs what it
   would kill).
2. Set in plugin config-dir `.env`: `GHOST_REAPER_SCRIPT=<path>` +
   `REAPER_LIVE=1`.
3. Verify via `herdr plugin log list --plugin com.chefgroep.pane-reaper`.
