#!/usr/bin/env bash
# herdr-grep: fzf + ripgrep live-grep over de repo van de actieve pane.
# Vim-loos alternatief voor cinco/herdr-grep-nvim (geen nvim-dependency).
#
# Gebruik:
#   search.sh [query]                 interactief (fzf live-grep) als er een TTY is,
#                                     anders niet-interactieve rg-dump van de query
# Env:
#   HERDR_GREP_QUERY      initiële query (ipv $1; handig via `herdr plugin action invoke`)
#   HERDR_GREP_NO_OPEN=1  selectie niet openen in een nieuwe pane (voor tests)
#   HERDR_GREP_OPEN_FIRST=1  niet-interactief: open de eerste match (voor tests)
#   HERDR_GREP_SCOPE      scope-dir forceren (voorrang op pane-detectie)
#   EDITOR                editor voor openen (default: less; nooit vim als fallback)
set -u

HERDR_BIN="${HERDR_BIN_PATH:-herdr}"
RG="${HERDR_GREP_RG:-rg}"
FZF="${HERDR_GREP_FZF:-fzf}"
QUERY="${1:-${HERDR_GREP_QUERY:-}}"

die() { printf 'herdr-grep: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# --- scope: repo van de gefocuste/aanroepende pane ---------------------------
pane_cwd_from_json() {
  # $1 = herdr pane-json op stdin-volgorde via arg; print foreground_cwd || cwd
  python3 -c '
import json,sys
try:
    doc = json.load(sys.stdin)
except Exception:
    sys.exit(1)
pane = (doc.get("result") or {}).get("pane") or {}
for key in ("foreground_cwd", "cwd"):
    if pane.get(key):
        print(pane[key])
        break
' 2>/dev/null
}

context_json_cwd() {
  # defensief: probeer bekende sleutelvormen uit HERDR_PLUGIN_CONTEXT_JSON
  [ -n "${HERDR_PLUGIN_CONTEXT_JSON:-}" ] || return 1
  HERDR_PLUGIN_CONTEXT_JSON="$HERDR_PLUGIN_CONTEXT_JSON" python3 -c '
import json,os,sys
try:
    doc = json.loads(os.environ["HERDR_PLUGIN_CONTEXT_JSON"])
except Exception:
    sys.exit(1)
cands = []
if isinstance(doc, dict):
    for k in ("pane", "focused_pane", "context", "action_context"):
        v = doc.get(k)
        if isinstance(v, dict):
            cands.append(v)
    cands.append(doc)
for c in cands:
    for k in ("foreground_cwd", "cwd", "directory", "repo_root", "workspace_root"):
        if c.get(k):
            print(c[k])
            sys.exit(0)
sys.exit(1)
' 2>/dev/null
}

pane_api_cwd() {
  # $1 = pane-id of leeg (--> pane current); print cwd bij succes
  local out
  if [ -n "${1:-}" ]; then
    out=$("$HERDR_BIN" pane get "$1" 2>/dev/null) || return 1
  else
    out=$("$HERDR_BIN" pane current 2>/dev/null) || return 1
  fi
  printf '%s' "$out" | pane_cwd_from_json
}

detect_scope() {
  local dir=""
  if [ -n "${HERDR_GREP_SCOPE:-}" ]; then
    dir="$HERDR_GREP_SCOPE"
  else
    dir=$(context_json_cwd) || dir=""
    if [ -z "$dir" ] && [ -n "${HERDR_PANE_ID:-}" ]; then
      dir=$(pane_api_cwd "$HERDR_PANE_ID") || dir=""
    fi
    if [ -z "$dir" ]; then
      dir=$(pane_api_cwd "") || dir=""
    fi
    [ -n "$dir" ] || dir="$PWD"
  fi
  # binnen een git-repo: toplevel als scope
  local top=""
  top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || top=""
  if [ -n "$top" ]; then printf '%s' "$top"; else printf '%s' "$dir"; fi
}

# --- open bestand:regel in een nieuwe herdr-pane -----------------------------
open_in_pane() {
  # $1 = scope-dir, $2 = "bestand:regel:..." rg-regel
  local scope="$1" sel="$2"
  local file="${sel%%:*}"
  local rest="${sel#*:}"
  local line="${rest%%:*}"
  case "$line" in ''|*[!0-9]*) line=1 ;; esac

  local editor="${EDITOR:-less}"
  local editor_base="${editor##*/}"
  local -a cmd
  case "$editor_base" in
    *code*|*cursor*|*codium*|*zed*)
      cmd=("$editor" --goto "$file:$line") ;;
    *)
      # vim/nano/less/helix begrijpen allemaal +<regel>
      # shellcheck disable=SC2206
      cmd=($editor "+$line" "$file") ;;
  esac

  local split_out new_id
  split_out=$("$HERDR_BIN" pane split --current --direction right --cwd "$scope" --no-focus 2>&1) \
    || die "pane split faalde: $split_out"
  new_id=$(printf '%s' "$split_out" | python3 -c '
import json,sys
doc = json.load(sys.stdin)
pane = (doc.get("result") or {}).get("pane") or {}
print(pane.get("pane_id") or (doc.get("result") or {}).get("pane_id") or "")
' 2>/dev/null) || die "split-output onleesbaar: $split_out"
  [ -n "$new_id" ] || die "geen pane-id in split-output: $split_out"

  "$HERDR_BIN" pane run "$new_id" "${cmd[@]}" >/dev/null 2>&1 \
    || die "pane run faalde in $new_id"
  printf 'geopend in %s: %s:%s (%s)\n' "$new_id" "$file" "$line" "$editor_base"
}

# --- main --------------------------------------------------------------------
have "$RG" || die "vereiste ontbreekt: rg (ripgrep) niet op PATH"
SCOPE=$(detect_scope)
[ -d "$SCOPE" ] || die "scope is geen directory: $SCOPE"

RG_BASE=("$RG" --line-number --no-heading --color=never --smart-case --hidden
         --glob '!.git' --glob '!node_modules' --glob '!.venv' --glob '!target')

if [ -t 0 ] && [ -t 1 ] && have "$FZF" && [ -z "${HERDR_GREP_NO_FZF:-}" ]; then
  # Interactief: live-grep via fzf reload-binding (vim-loze tegenhanger van
  # herdr-grep-nvim). Enter opent de match in een nieuwe herdr-pane.
  cd "$SCOPE" || die "kan niet naar scope: $SCOPE"
  sel=$(
    "${RG_BASE[@]}" -- "" 2>/dev/null | "$FZF" \
      --ansi \
      --prompt "grep> " \
      --query "$QUERY" \
      --disabled \
      --delimiter ':' \
      --preview 'f={1}; l={2}; [ -f "$f" ] && sed -n "$((l-3>0?l-3:1)),+10p" "$f"' \
      --preview-window 'right,50%,border-bottom' \
      --bind "change:reload:$RG --line-number --no-heading --color=never --smart-case --hidden --glob '!.git' --glob '!node_modules' -- {q} . 2>/dev/null || true" \
      --bind 'enter:accept' \
      < /dev/tty > /dev/tty
  ) || exit 0  # Esc/Ctrl-C = geen selectie, geen fout
  [ -n "${sel:-}" ] || exit 0
  if [ -n "${HERDR_GREP_NO_OPEN:-}" ]; then
    printf '%s\n' "$sel"
  else
    open_in_pane "$SCOPE" "$sel"
  fi
  exit 0
fi

# Niet-interactief (geen TTY, bv. `herdr plugin action invoke`): dump matches.
have "$FZF" || printf 'herdr-grep: fzf niet op PATH, niet-interactieve rg-dump\n' >&2
if [ -z "$QUERY" ]; then
  # zonder query: toon wat er te greppen valt (eerste 30 regels met regelnrs)
  "${RG_BASE[@]}" -- "" "$SCOPE" 2>/dev/null | head -n 30
  exit 0
fi
matches=$("${RG_BASE[@]}" -- "$QUERY" "$SCOPE" 2>/dev/null | head -n 50)
[ -n "$matches" ] || { printf 'herdr-grep: geen matches voor %s (scope %s)\n' "$QUERY" "$SCOPE" >&2; exit 1; }
printf '%s\n' "$matches"
if [ -n "${HERDR_GREP_OPEN_FIRST:-}" ] && [ -z "${HERDR_GREP_NO_OPEN:-}" ]; then
  open_in_pane "$SCOPE" "$(printf '%s\n' "$matches" | head -n 1)"
fi
