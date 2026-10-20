# Kater MCP Bridge

Herdr plugin that exposes the local [Kater MCP Gateway](http://127.0.0.1:9091) as Fleet Ops Bar fragments and actions.

Design reference: [CHEF-KATER-BRIDGE-DESIGN.md](https://github.com/GroepOnline/herdr/blob/main/docs/CHEF-KATER-BRIDGE-DESIGN.md) in the herdr repo.

## Requirements

- Kater gateway running locally (`kater serve`, default REST **9091**, MCP SSE **9090**)
- Herdr ≥ 0.7.3

## Configuration

Optional plugin config `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `KATER_API_KEY` | _(unset)_ | Gateway API key; sent as `Authorization: Bearer` on REST and MCP SSE calls. Required when the gateway runs `auth_mode=apikey` (Kater v1.1.x and later). |
| `KATER_API_URL` | `http://127.0.0.1:9091` | Kater REST base URL |
| `KATER_MCP_URL` | derived from API URL (`:9090/sse`) | Kater MCP SSE endpoint |

The key is only sent over HTTPS or to a loopback gateway (`localhost`, `::1`,
`127.0.0.0/8`). Pointing `KATER_API_URL`/`KATER_MCP_URL` at a remote host over
plaintext HTTP makes the bridge refuse to send it and log the reason, so use
HTTPS or a tunnel that terminates on loopback.

## Actions

| Action | Source | Fragment component |
|--------|--------|-------------------|
| **Fleet Status** | REST `/health`, `/api/status` + MCP `utrecht_fleet_inventory` | `kater` |
| **Pipeline Health** | REST `/api/doctor` + MCP `utrecht_pipeline_status`, `utrecht_status` | `kater-doctor` |
| **PR Gate Verdict** | REST `/api/pr/list`, `/api/pr/{n}/gate` | `kater-pr` |
| **Query Utrecht Data** | MCP `utrecht_ask` | `kater-query` |

## Events

- `workspace.focused` → refreshes fleet status, doctor summary, and PR gate for the active workspace.

## Pane

- **Utrecht Fleet** tab aggregates gateway health, profile, servers, doctor findings, and fleet node counts.

## Local dev

```bash
npm install && npm run build
npm test                    # build + node --test dist/common.test.js
npm run smoke               # MCP smoke test (needs Kater on :9090/:9091)
npm run fleet-status        # writes fragment to $HERDR_PLUGIN_STATE_DIR
```

## Version history

- **v0.2.2** — Gateway API key (`KATER_API_KEY`) sent on REST and MCP SSE, with input validation and a fail-closed TLS guard for non-loopback plaintext endpoints.
- **v0.2.0** — MCP SSE client (`@modelcontextprotocol/sdk`) for Utrecht tools: fleet inventory, pipeline status, natural-language ask.
- **v0.1.0** — REST-only gateway health, doctor, PR gate (see [PR #2](https://github.com/GroepOnline/herdr-plugins/pull/2), operator-gated merge).

## Not yet implemented (design)

- Unified health aggregator (CF tunnels + Tailscale + Grafana)
- Cloudflare tunnel correlation alerts
