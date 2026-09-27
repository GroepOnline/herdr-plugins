---
name: herdr-board
description: Read-only agent message-board viewer in herdr (overlay pane). Use when the user asks about the board, open tasks, or findings across agent sessions.
---

# herdr-board

Read-only view of the opencode agent message-board (`board.jsonl` entries:
`{id, ts, updated, author, project, text, tag, status, note}`).
Claim/post stays in opencode (`board.*` tools, `/board` command). This plugin
NEVER writes.

## Invoke

```bash
herdr plugin action invoke com.chefgroep.herdr-board.show      # open/claimed, newest first
herdr plugin action invoke com.chefgroep.herdr-board.show-all  # all statuses
```

Opens the board as an **overlay pane** (on top, `Esc` closes, 15s auto-refresh).
Key (Joep's config): `prefix+t`.

## Board path resolution (first hit wins)

1. `$HERDR_BOARD_PATH` or `$BOARD_PATH` env
2. `<config-dir>/board-path` (plain text, first line)
3. `<config-dir>/board.conf` (`BOARD_PATH=<path>` line)
4. Default: `~/.local/share/opencode/board/board.jsonl`

Missing file or malformed JSONL lines: friendly message, exit 0 (skipped
lines are counted, never fatal).
