#!/usr/bin/env bash
# herdr-grep: fzf + ripgrep live-grep over de repo van de actieve pane.
# Vim-loos alternatief voor cinco/herdr-grep-nvim (geen nvim-dependency).
#
# Modi:
#   als herdr-action (HERDR_PLUGIN_ACTION_ID gezet): dispatcher. Herdr-actions
#     draaien headless (stdio gepiped, nooit een TTY), dus fzf kan daar niet
#     lopen. De dispatcher opent een nieuwe herdr-pane en start daar de
#     interactieve UI (echte TTY) via `pane split` + `pane run`.
#   direct in een terminal met TTY: interactieve live-grep; Enter opent de
#     match als bestand:regel in een nieuwe herdr-pane ($EDITOR, fallback less).
#   direct zonder TTY: niet-interactieve rg-dump (max 50 matches).
#
# Gebruik (direct):
#   search.sh [--ui] [--scope DIR] [--query Q] [query]
# Env (alleen direct-run; herdr-actions krijgen geen caller-env mee):
#   HERDR_GREP_QUERY      initiële query (ipv $1)
#   HERDR_GREP_SCOPE      scope-dir forceren (voorrang op pane-detectie)
#   HERDR_GREP_NO_OPEN=1  selectie printen ipv openen (tests)
#   HERDR_GREP_OPEN_FIRST=1  niet-interactief: eerste match openen (tests)
#   EDITOR                editor voor openen (default: less; nooit vim als fallback)
set -u

HERDR_BIN="${HERDR_BIN_PATH:-herdr}"
RG="${HERDR_GREP_RG:-rg}"
FZF="${HERDR_GREP_FZF:-fzf}"
PLUGIN_ROOT="$PWD" # herdr start action-commando's in de plugin-root

UI=0
SCOPE_ARG=""
QUERY_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ui) UI=1; shift ;;
    --scope) SCOPE_ARG="${2:-}"; shift 2 ;;
    --scope=*) SCOPE_ARG="${1#--scope=}"; shift ;;
    --query) QUERY_ARG="${2:-}"; shift 2 ;;
    --query=*) QUERY_ARG="${1#--query=}"; shift ;;
    --) shift; break ;;
    -*) printf 'herdr-grep: onbekende vlag %s\n' "$1" >&2; exit 2 ;;
    *) break ;;
  esac
done
QUERY="${1:-${QUERY_ARG:-${HERDR_GREP_QUERY:-}}}"

die() { printf 'herdr-grep: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
is_action() { [ -n "${HERDR_PLUGIN_ACTION_ID:-}" ]; }

# --- scope: repo van de gefocuste/aanroepende pane ---------------------------
pane_cwd_from_json() {
  # herdr pane-json op stdin; print foreground_cwd || cwd
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
  # HERDR_PLUGIN_CONTEXT_JSON is een PluginInvocationContext (zie
  # herdr src/api/schema/plugins.rs): focused_pane_cwd, workspace_cwd, ...
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
    for k in ("focused_pane_cwd", "foreground_cwd", "cwd",
              "workspace_cwd", "directory", "repo_root", "workspace_root"):
        if c.get(k):
            print(c[k])
            sys.exit(0)
sys.exit(1)
' 2>/dev/null
}

context_json_query() {
  # selected_text uit de action-context als initiële query (eerste regel, max 200)
  [ -n "${HERDR_PLUGIN_CONTEXT_JSON:-}" ] || return 1
  HERDR_PLUGIN_CONTEXT_JSON="$HERDR_PLUGIN_CONTEXT_JSON" python3 -c '
import json,os,sys
try:
    doc = json.loads(os.environ["HERDR_PLUGIN_CONTEXT_JSON"])
except Exception:
    sys.exit(1)
sel = doc.get("selected_text") if isinstance(doc, dict) else None
if sel:
    line = str(sel).strip().splitlines()[0][:200]
    if line:
        print(line)
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
  if [ -n "${SCOPE_ARG:-}" ]; then
    dir="$SCOPE_ARG"
  elif [ -n "${HERDR_GREP_SCOPE:-}" ]; then
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

split_pane() {
  # $1 = cwd, $2 = focus|nofocus; print nieuwe pane-id
  local focus_flag="--no-focus"
  [ "${2:-nofocus}" = "focus" ] && focus_flag="--focus"
  local split_out new_id
  split_out=$("$HERDR_BIN" pane split --current --direction right --cwd "$1" "$focus_flag" 2>&1) \
    || die "pane split faalde: $split_out"
  new_id=$(printf '%s' "$split_out" | python3 -c '
import json,sys
doc = json.load(sys.stdin)
pane = (doc.get("result") or {}).get("pane") or {}
print(pane.get("pane_id") or (doc.get("result") or {}).get("pane_id") or "")
' 2>/dev/null) || die "split-output onleesbaar: $split_out"
  [ -n "$new_id" ] || die "geen pane-id in split-output: $split_out"
  printf '%s' "$new_id"
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

  local new_id
  new_id=$(split_pane "$scope" nofocus)
  "$HERDR_BIN" pane run "$new_id" "${cmd[@]}" >/dev/null 2>&1 \
    || die "pane run faalde in $new_id"
  printf 'geopend in %s: %s:%s (%s)\n' "$new_id" "$file" "$line" "$editor_base"
}

# --- dispatcher: herdr-action opent de interactieve UI in een nieuwe pane ----
dispatch_ui() {
  local scope query new_id
  scope=$(detect_scope)
  [ -d "$scope" ] || die "scope is geen directory: $scope"
  query=$(context_json_query) || query=""
  new_id=$(split_pane "$scope" focus)
  if [ -n "$query" ]; then
    "$HERDR_BIN" pane run "$new_id" bash "$PLUGIN_ROOT/src/search.sh" \
      --ui --scope "$scope" --query "$query" >/dev/null 2>&1 \
      || die "pane run faalde in $new_id"
  else
    "$HERDR_BIN" pane run "$new_id" bash "$PLUGIN_ROOT/src/search.sh" \
      --ui --scope "$scope" >/dev/null 2>&1 \
      || die "pane run faalde in $new_id"
  fi
  printf 'grep-pane %s (scope %s)\n' "$new_id" "$scope"
}

# --- interactieve UI: fzf live-grep (vereist een TTY) -------------------------
run_ui() {
  local scope="$1" query="$2"
  have "$RG" || die "vereiste ontbreekt: rg (ripgrep) niet op PATH"
  have "$FZF" || die "vereiste ontbreekt: fzf niet op PATH"
  cd "$scope" || die "kan niet naar scope: $scope"
  local sel
  # Live-grep via fzf reload-binding (vim-loze tegenhanger van herdr-grep-nvim).
  # Enter opent de match in een nieuwe herdr-pane. Stdin = kandidaat-pipe;
  # fzf gebruikt zelf /dev/tty voor de UI (standaard `rg | fzf`-patroon).
  sel=$(
    "$RG" --line-number --no-heading --color=never --smart-case --hidden \
      --glob '!.git' --glob '!node_modules' --glob '!.venv' --glob '!target' \
      -- "" 2>/dev/null | "$FZF" \
      --ansi \
      --prompt "grep> " \
      --query "$query" \
      --disabled \
      --delimiter ':' \
      --preview 'f={1}; l={2}; [ -f "$f" ] && sed -n "$((l-3>0?l-3:1)),+10p" "$f"' \
      --preview-window 'right,50%,border-bottom' \
      --bind "change:reload:$RG --line-number --no-heading --color=never --smart-case --hidden --glob '!.git' --glob '!node_modules' -- {q} . 2>/dev/null || true" \
      --bind 'enter:accept'
  ) || exit 0 # Esc/Ctrl-C = geen selectie, geen fout
  [ -n "${sel:-}" ] || exit 0
  if [ -n "${HERDR_GREP_NO_OPEN:-}" ]; then
    printf '%s\n' "$sel"
  else
    open_in_pane "$scope" "$sel"
  fi
}

# --- niet-interactieve rg-dump (geen TTY) -------------------------------------
run_dump() {
  local scope="$1" query="$2"
  have "$RG" || die "vereiste ontbreekt: rg (ripgrep) niet op PATH"
  if [ -z "$query" ]; then
    "$RG" --line-number --no-heading --color=never --smart-case --hidden \
      --glob '!.git' --glob '!node_modules' --glob '!.venv' --glob '!target' \
      -- "" "$scope" 2>/dev/null | head -n 30
    exit 0
  fi
  local matches
  matches=$("$RG" --line-number --no-heading --color=never --smart-case --hidden \
    --glob '!.git' --glob '!node_modules' --glob '!.venv' --glob '!target' \
    -- "$query" "$scope" 2>/dev/null | head -n 50)
  [ -n "$matches" ] || { printf 'herdr-grep: geen matches voor %s (scope %s)\n' "$query" "$scope" >&2; exit 1; }
  printf '%s\n' "$matches"
  if [ -n "${HERDR_GREP_OPEN_FIRST:-}" ] && [ -z "${HERDR_GREP_NO_OPEN:-}" ]; then
    open_in_pane "$scope" "$(printf '%s\n' "$matches" | head -n 1)"
  fi
}

# --- main --------------------------------------------------------------------
if is_action; then
  # Headless action-context (stdio gepiped): open UI-pane, nooit fzf hier.
  dispatch_ui
  exit 0
fi

SCOPE=$(detect_scope)
[ -d "$SCOPE" ] || die "scope is geen directory: $SCOPE"

if [ "$UI" = "1" ] || { [ -t 0 ] && [ -t 1 ]; }; then
  [ -t 0 ] && [ -t 1 ] || die "--ui vereist een TTY"
  run_ui "$SCOPE" "$QUERY"
else
  if ! have "$FZF"; then
    printf 'herdr-grep: fzf niet op PATH, niet-interactieve rg-dump\n' >&2
  fi
  run_dump "$SCOPE" "$QUERY"
fi
