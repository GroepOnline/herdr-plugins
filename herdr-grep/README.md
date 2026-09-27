# com.chefgroep.grep

fzf + ripgrep live-grep over de repo van de actieve herdr-pane — het vim-loze
alternatief voor `cinco/herdr-grep-nvim` (dat nvim vereist). Geen nvim, geen
vim-dependency; openen gaat via `$EDITOR` met `less` als fallback.

## Action

| Action | Wat | Output |
|---|---|---|
| `search [query]` | Live-grep (rg + fzf `--disabled` + `change:reload`) over de repo-root van de gefocuste pane; `bestand:regel:tekst`, Enter opent `bestand:regel` in een nieuwe herdr-pane | selectie of matchlijst |

Scope-bepaling: `HERDR_GREP_SCOPE` > `HERDR_PLUGIN_CONTEXT_JSON` (pane-cwd) >
`HERDR_PANE_ID` via `$HERDR_BIN_PATH pane get` > `pane current` > `$PWD`;
binnen een git-repo wordt de toplevel als scope gebruikt.

Openen: `herdr pane split --current --direction right --cwd <scope> --no-focus`
gevolgd door `herdr pane run <nieuwe-pane> $EDITOR +<regel> <bestand>`
(`--goto bestand:regel` voor code/cursor/codium/zed). `$EDITOR` wordt
gerespecteerd; zonder `$EDITOR` is de fallback `less`, nooit vim.
Herdr-aanroepen gaan via `$HERDR_BIN_PATH` (fallback `herdr`),
zelfde conventie als `dirigent-dispatch`.

Zonder TTY (bv. `herdr plugin action invoke`) degradeert de action naar een
niet-interactieve rg-dump (max 50 matches) in plaats van te falen.

| Env | Default | Betekenis |
|---|---|---|
| `HERDR_GREP_QUERY` | – | initiële query (ipv `$1`) |
| `HERDR_GREP_SCOPE` | pane-detectie | scope-dir forceren |
| `HERDR_GREP_NO_OPEN` | – | selectie printen ipv openen (tests) |
| `HERDR_GREP_OPEN_FIRST` | – | niet-interactief: eerste match openen (tests) |
| `EDITOR` | `less` | editor voor openen |

## Vereisten

- `rg` (ripgrep, bv. linuxbrew) op PATH — geen bundeling
- `fzf` (bv. `/usr/bin/fzf`) op PATH — geen bundeling
- `python3` (stdlib, alleen voor herdr-JSON parsing)
