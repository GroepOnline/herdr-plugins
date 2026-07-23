# Kater MCP Bridge

Herdr plugin that exposes the local [Kater MCP Gateway](http://127.0.0.1:9091) as Fleet Ops Bar fragments and actions.

Design reference: [CHEF-KATER-BRIDGE-DESIGN.md](https://github.com/OnlineChefGroep/herdr/blob/main/docs/CHEF-KATER-BRIDGE-DESIGN.md) in the herdr repo.

## Requirements

- Kater gateway running locally (`kater serve`, default REST port **9091**)
- Herdr ≥ 0.7.3

## Configuration

Optional plugin config `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `KATER_API_URL` | `http://127.0.0.1:9091` | Kater REST base URL |

## Actions

| Action | REST endpoints | Fragment component |
|--------|----------------|-------------------|
| **Fleet Status** | `GET /health`, `GET /api/status` | `kater` |
| **Pipeline Health** | `GET /api/doctor` | `kater-doctor` |
| **PR Gate Verdict** | `GET /api/pr/list`, `GET /api/pr/{n}/gate` | `kater-pr` |
| **Query Utrecht Data** | — (MCP `utrecht_ask` only; stub in v0.1) | `kater-query` |

## Events

- `workspace.focused` → refreshes fleet status, doctor summary, and PR gate for the active workspace.

## Pane

- **Utrecht Fleet** tab aggregates gateway health, profile, servers, and doctor findings.

## Local dev

```bash
npm install && npm run build
KATER_API_URL=http://127.0.0.1:9091 npm run fleet-status
```

## v0.1 limitations

- Utrecht fleet inventory (`utrecht_fleet_inventory`) and pipeline status (`utrecht_pipeline_status`) are MCP tools only; this plugin uses the available REST surface (`/health`, `/api/status`, `/api/doctor`, `/api/pr/*`).
- Natural-language query requires MCP SSE gateway, not REST.
