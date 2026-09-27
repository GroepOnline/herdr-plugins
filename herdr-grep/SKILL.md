---
name: herdr-grep
description: fzf + ripgrep live-grep over the repo of the focused herdr pane (vim-free). Use when searching code vaguely by content without leaving herdr.
---

# herdr-grep

Vim-free live-grep: `rg --line-number` piped through `fzf`, scoped to the repo
of the focused/calling pane. No nvim dependency (unlike herdr-grep-nvim).

## Invoke

```bash
herdr plugin action invoke com.chefgroep.grep.search
```

With a query (non-interactive use, tests, agents):

```bash
HERDR_GREP_QUERY='pattern' herdr plugin action invoke com.chefgroep.grep.search
```

## Env

| Var | Meaning |
|---|---|
| `HERDR_GREP_QUERY` | initial query (else interactive fzf) |
| `HERDR_GREP_SCOPE` | force scope dir (else pane repo auto-detect) |
| `HERDR_GREP_NO_OPEN=1` | print matches only, don't open selection |
| `HERDR_GREP_OPEN_FIRST=1` | non-interactive: open first match |
| `EDITOR` | opener for selection (default `less`; never vim as fallback) |

Requires `fzf` + `rg` on PATH. Scope detection reads the focused pane cwd via
`HERDR_BIN_PATH`; override with `HERDR_GREP_SCOPE` when invoking headless.
