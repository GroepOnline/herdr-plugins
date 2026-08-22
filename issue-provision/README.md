# com.chefgroep.issue-provision

Beheert workspaces die uit Linear issues zijn ingericht, voor de Herdr Fleet Ops Bar.

**SSOT:** de `provisioned.json`-ledger in de plugin state dir + Linear issue-ids (`GRO-123`). De plugin is de boekhouding; het echte workspace-aanmaken gebeurt in GroepOnline/herdr-ops en herdr worktree-flows.

## Actions

| Action | Wat | Output |
|---|---|---|
| `provision [GRO-123]` | Zet een issue in de ledger (id uit arg, `HERDR_LINEAR_ISSUE_ID`, of een aangeklikte Linear-issue-URL) | actuele provisioned-lijst |
| `teardown GRO-123` | Haalt de issue uit de ledger; fout als hij er niet in staat | restende lijst |
| `list-provisioned` | Toont de ledger | alle entries met `provisioned_at` |

Issue-ids worden strikt gevalideerd op `[A-Z]+-\d+`. Ledger én heartbeat worden atomisch geschreven (`ttl_seconds: 60`).

## Config

| Env | Default | Betekenis |
|---|---|---|
| `HERDR_PLUGIN_STATE_DIR` | – (verplicht) | state dir voor `fleet_ops.json` + `provisioned.json` |
| `HERDR_LINEAR_ISSUE_ID` | – | fallback issue-id |
| `HERDR_PLUGIN_CLICKED_URL` | – | Linear-URL uit de `linear-issue` link_handler |

## Voorbeeld

```console
$ node src/index.js provision GRO-999
{"ok":true,"action":"provision","issue":{"id":"GRO-999","status":"provision"},"provisioned":["GRO-999"]}
$ node src/index.js teardown GRO-999
{"ok":true,"action":"teardown","issue":{"id":"GRO-999","status":"teardown"},"provisioned":[]}
```
