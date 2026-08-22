# com.chefgroep.udo-metrics

Host-metrics van Utrecht Data OS-nodes voor de Herdr Fleet Ops Bar.

**SSOT:** live `load1` + uptime via SSH op elke node (`/proc/loadavg` + `uptime -p`). Geen tokens, geen cache.

## Actions

| Action | Wat | Output |
|---|---|---|
| `refresh-metrics` | Probeert alle nodes uit `CHEF_UDO_NODES` parallel (SSH, 8s timeout) | per-node `reachable`, `load1`, `uptime`; summary `udo: n/m nodes reporting` |
| `fetch-node <node>` | Eén node proberen | zelfde velden voor die node |
| `on-workspace-focused` | Heartbeat-only | laatste heartbeat |

Zonder `CHEF_UDO_NODES` degradeert de plugin expliciet met de hint `set CHEF_UDO_NODES`.

Heartbeat schrijft atomair `fleet_ops.json` (`ttl_seconds: 60`).

## Config

| Env | Default | Betekenis |
|---|---|---|
| `HERDR_PLUGIN_STATE_DIR` | – (verplicht) | state dir voor `fleet_ops.json` |
| `CHEF_UDO_NODES` | *(leeg)* | komma-gescheiden UDO-node-hostnames, bijv. `bc-scan-arm,bc-scan-2` |

Nodenamen worden gevalideerd op `[a-zA-Z0-9._-]`; ssh krijgt array-args, nooit shell-concat.

## Vereisten

- SSH BatchMode-toegang tot elke geconfigureerde node.
