# com.chefgroep.ops

Runtime-location heartbeat voor de Fleet Ops Bar — bewust een smal contract.

Schrijft een schema-compatible `fleet_ops.json`-fragment (`source`, `updated_at`, `ttl_seconds: 90`) en toont in de CLI-respons **waar de runtime draait**: host, socket-pad en de pointer naar het productierepo.

**Volledige inventaris (Tailscale, SSH-probes, UDO/Kater-SSOT's) hoort thuis in [GroepOnline/herdr-ops](https://github.com/GroepOnline/herdr-ops).** Dit fragment is bewust beperkt tot de keys die Herdr core leest (`src/fleet/ops.rs::PluginFleetFragment`) — extra keys worden stil gedropt bij deserialisatie. Runtime-locatie gaat daarom via de CLI-respons, niet via het bestand.

## Actions

| Action | Wat |
|---|---|
| `publish-context` | Heartbeat schrijven + runtime-locatie tonen |
| `on-workspace-focused` | Zelfde, getriggerd door Herdr core |

## Output

```json
{"ok":true,"action":"publish-context","host":"joep","recommended_repo":"GroepOnline/herdr-ops",
 "location":{"host":"joep","socket":"default","note":"scaffold → herdr-ops"}}
```
