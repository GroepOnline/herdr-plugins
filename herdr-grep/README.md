# com.chefgroep.grep

fzf + ripgrep live-grep over de repo van de actieve herdr-pane — het vim-loze
alternatief voor `cinco/herdr-grep-nvim` (dat nvim vereist). Geen nvim, geen
vim-dependency; openen gaat via `$EDITOR` met `less` als fallback.

## Action

| Action | Wat | Output |
|---|---|---|
| `search` | Dispatcher: bepaalt scope (repo van gefocuste pane, query uit geselecteerde tekst) en opent de live-grep UI in een nieuwe pane (`--focus`) | `grep-pane <id> (scope <dir>)` |

Herdr-actions draaien headless (stdio gepiped, nooit een TTY — zie herdr
`src/app/api/plugins/runtime.rs`), dus fzf loopt niet in de action zelf maar
in de nieuw geopende pane (echte TTY). De UI is dezelfde `src/search.sh` met
`--ui`, gestart via `pane split` + `pane run` (zelfde `$HERDR_BIN_PATH`-conventie
als `dirigent-dispatch`). In de UI: live-grep via fzf (`--disabled` +
`change:reload`), `bestand:regel:tekst`, Enter opent `bestand:regel` in wéér
een nieuwe pane.

Scope-bepaling: `--scope` > `HERDR_GREP_SCOPE` > `HERDR_PLUGIN_CONTEXT_JSON`
(`focused_pane_cwd`, dan `workspace_cwd`) > `HERDR_PANE_ID` via
`$HERDR_BIN_PATH pane get` > `pane current` > `$PWD`; binnen een git-repo wordt
de toplevel als scope gebruikt. Initiële query: `--query` > `$1` >
`HERDR_GREP_QUERY` > `selected_text` uit de action-context.

Openen: `herdr pane split --current --direction right --cwd <scope> --no-focus`
gevolgd door `herdr pane run <nieuwe-pane> $EDITOR +<regel> <bestand>`
(`--goto bestand:regel` voor code/cursor/codium/zed). `$EDITOR` wordt
gerespecteerd; zonder `$EDITOR` is de fallback `less`, nooit vim.
Herdr-aanroepen gaan via `$HERDR_BIN_PATH` (fallback `herdr`),
zelfde conventie als `dirigent-dispatch`.

Zonder TTY (direct run, bv. in tests) degradeert het script naar een
niet-interactieve rg-dump (max 50 matches) in plaats van te falen. Let op:
`herdr plugin action invoke` stuurt géén caller-env mee (invoke is een
socket-API-call; de server spawnt de action met alleen `HERDR_PLUGIN_*`-vars),
dus `HERDR_GREP_QUERY`/`HERDR_GREP_SCOPE` werken alleen bij direct runnen van
`src/search.sh`, niet via invoke.

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
