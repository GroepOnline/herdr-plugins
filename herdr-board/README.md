# com.chefgroep.herdr-board — Agent Board (read-only)

Compacte read-only viewer voor het opencode agent message-board
(`~/.local/share/opencode/board/board.jsonl`).

**v1 is strikt read-only:** claimen/posten blijft in opencode (`/board` commando).
Entries: `{id, ts, updated, author, project, text, tag, status, note}` —
`tag ∈ question|task|finding|status|block`, `status ∈ open|claimed|done|wontdo`.

## Actions / pane

| Entry | Wat |
|---|---|
| action `show` | open/claimed items, nieuwste eerst: `glyph id [tag] auteur — eerste ~120 tekens` |
| action `show-all` | alle statussen, nieuwste eerst |
| pane `board` | split-pane, zelfde lijst + auto-refresh (15s poll) bij board-wijzigingen |

Glyphs: `○` open · `◐` claimed · `●` done · `✕` wontdo. Max 50 regels (`--limit N`).

## Board-pad

Default: `~/.local/share/opencode/board/board.jsonl`. Overschrijfbaar (eerste hit wint):

1. env `HERDR_BOARD_PATH` (fallback `BOARD_PATH`)
2. bestand `<config-dir>/board-path` (eerste regel = pad)
3. bestand `<config-dir>/board.conf` (regel `BOARD_PATH=<pad>`)

Config-dir: `herdr plugin config-dir com.chefgroep.herdr-board`
(standalone: `$HERDR_PLUGIN_CONFIG_DIR`, anders `~/.config/herdr/plugins/com.chefgroep.herdr-board`).
