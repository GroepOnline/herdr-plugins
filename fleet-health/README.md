# com.chefgroep.fleet-health

Tailscale fleet-health + per-node SSH-probes voor de Herdr Fleet Ops Bar.

**SSOT:** `tailscale status --json` en echte SSH-probes vanaf deze host. Geen cached state.

## Actions

| Action | Wat | Output |
|---|---|---|
| `scan-fleet` | Parseert `tailscale status --json` (5s timeout) en telt online peers | `fleet.online`, `fleet.total`, summary `fleet: n/m online`, per-peer lijst |
| `scan-node <node>` | SSH-probe (`BatchMode=yes`, `ConnectTimeout=5`) naar één host | `reachable`, `latency_ms` |
| `on-workspace-focused` | Heartbeat-only | laatste heartbeat |

Heartbeat schrijft atomair `fleet_ops.json` (`ttl_seconds: 120`). Is `tailscale` niet geïnstalleerd of geeft invalid JSON, dan degradeert de plugin expliciet (`online: null`, reden in de summary) in plaats van te gokken.

## Config

| Env | Default | Betekenis |
|---|---|---|
| `HERDR_PLUGIN_STATE_DIR` | – (verplicht) | state dir voor `fleet_ops.json` |

Nodenamen worden gevalideerd op `[a-zA-Z0-9._-]` voordat ze naar ssh gaan (array-args, geen shell-concat).

## Vereisten

- `tailscale` op PATH (voor `scan-fleet`)
- SSH BatchMode-toegang tot de gevraagde node (voor `scan-node`)
