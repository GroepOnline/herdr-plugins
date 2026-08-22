# com.chefgroep.cloudflare-tunnel

Cloudflare tunnel + DNS health voor de Herdr Fleet Ops Bar.

**SSOT:** live HTTPS-bereikbaarheid van tunnel-backed hosts en echte DNS-antwoorden. Geen tokens, geen cache.

## Actions

| Action | Wat | Output |
|---|---|---|
| `check-tunnels` | HTTPS-probe (GET, 5s timeout) tegen elke geconfigureerde host | per-host `ok`, HTTP `status`, `latency_ms`; heartbeat-summary `tunnels: n/m healthy` |
| `check-dns [host]` | Resolveert alle geconfigureerde hosts (of één opgegeven host) via de systeem-resolver | per-host `resolved` + adressen; summary `dns: n/m resolved` |
| `dig-probe <host>` | Zelfde resolver-probe voor één host (alias van `check-dns <host>`) | idem |
| `on-workspace-focused` | Heartbeat-only, probeert niets en schrijft geen state | heartbeat-event |

De probe-actions schrijven een atomair `fleet_ops.json`-fragment (`source`, `updated_at`, `ttl_seconds: 300`, `cloudflare.tunnels_healthy`, `cloudflare.summary`) dat de Fleet Ops Bar leest. Het focus-heartbeat schrijft bewust niets, zodat het geen verse probe-resultaten kan overschrijven.

## Config

| Env | Default | Betekenis |
|---|---|---|
| `HERDR_PLUGIN_STATE_DIR` | – (verplicht, gezet door Herdr core) | state dir voor `fleet_ops.json` |
| `CHEF_TUNNEL_HOSTS` | `herdr.chefgroep.nl,i.chefgroep.nl` | komma-gescheiden hosts die geprobeerd worden |

Hostnamen worden gevalideerd op `[a-z0-9.-]`. Een onbereikbare host is geen error maar expliciet `ok:false` met reden in het resultaat — de bar toont dan eerlijk `n/m`.

## Voorbeeld

```console
$ node src/index.js check-tunnels
{"ok":true,"action":"check-tunnels","path":"…/fleet_ops.json",
 "cloudflare":{"tunnels_healthy":1,"summary":"tunnels: 1/1 healthy"},
 "results":[{"host":"herdr.chefgroep.nl","ok":true,"status":200,"latency_ms":207,"error":null}]}
```
