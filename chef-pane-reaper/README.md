# Pane Exit Reaper

Herdr plugin that invokes [`ghost-reaper.sh`](https://github.com/GroepOnline/.cursor/blob/main/hooks/ghost-reaper.sh) when a terminal pane exits, cleaning orphaned Cursor-agent and MCP child processes.

## Events

- `pane.exited` — runs reaper (dry-run by default)

## Configuration (`.env` in plugin config dir)

| Variable | Default | Description |
|----------|---------|-------------|
| `GHOST_REAPER_SCRIPT` | `~/.cursor/hooks/ghost-reaper.sh` | Path to reaper script |
| `REAPER_LIVE` | unset (`0`) | Set to `1` to kill processes (not dry-run) |

## Safety

Default is **dry-run only**. Set `REAPER_LIVE=1` only after validating reaper output on your machine.

## Local dev

```bash
npm install && npm run build
HERDR_PLUGIN_EVENT=pane.exited node dist/reap-on-exit.js
```
