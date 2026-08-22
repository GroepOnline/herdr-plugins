# com.chefgroep.chatgpt-bridge

Maakt Herdr bereikbaar voor **ChatGPT (app/web)** en andere MCP-clients, naar het patroon van [Desktop Commander MCP](https://github.com/wonderwhy-er/DesktopCommanderMCP): één remote-MCP endpoint dat de lokale machine bestuurbaar maakt vanuit een chat-UI.

Nul dependencies — alleen Node 20+ en de `herdr` CLI.

## Tools

| Tool | Type | Wat |
|---|---|---|
| `herdr_snapshot` | read | Live workspaces/tabs/panes/agents met ids, status en cwd |
| `herdr_read_agent` | read | Recente terminal-output van één agent/pane |
| `herdr_capture_agent` | **write** | Begrensde en geredacteerde pane-output opslaan in de plugin export-map |
| `herdr_prompt_agent` | **write** | Prompt submitten aan een draaiende agent |
| `herdr_notify` | **write** | Desktop-notificatie via Herdr |

**Read-only by default.** De write-tools bestaan pas als `CHEF_CHATGPT_ALLOW_WRITE=1` staat — ChatGPT ziet ze dan pas in `tools/list`.

## Modes

```console
$ node src/mcp-server.js serve     # Streamable HTTP op http://127.0.0.1:8791/mcp
$ node src/mcp-server.js stdio     # newline JSON-RPC op stdin/stdout (lokale MCP-clients)
$ node src/mcp-server.js doctor    # tools + write-gate + herdr-bereikbaarheid
$ node src/mcp-server.js capture-focused # gefocuste agent-output veilig vastleggen
$ node src/mcp-server.js selftest  # redaction, pane-validatie en byte-cap
$ node src/mcp-server.js stop      # serve stoppen via pidfile
```

`capture-focused` is ook een Herdr plugin action. De action schrijft alleen naar
`$HERDR_PLUGIN_STATE_DIR/exports`, atomair en met bestandsmodus `0600`. Output is
begrensd op 256 KiB en veelvoorkomende credentials worden vóór het schrijven
geredacteerd. De remote MCP-tool voor capture blijft onderdeel van de write-gate.

## Config

| Env | Default | Betekenis |
|---|---|---|
| `HERDR_PLUGIN_STATE_DIR` | – | state dir (pidfile), gezet door Herdr core |
| `CHEF_CHATGPT_PORT` | `8791` | HTTP-poort (bindt uitsluitend op 127.0.0.1) |
| `CHEF_CHATGPT_TOKEN` | – | wanneer gezet: vereist `Authorization: Bearer <token>` |
| `CHEF_CHATGPT_ALLOW_WRITE` | uit | zet op `1` om prompt/notify-tools toe te voegen |

## Testen zonder ChatGPT

```console
$ curl -s localhost:8791/healthz
$ echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node src/mcp-server.js stdio
```

## ChatGPT koppelen (roadmap)

ChatGPT custom connectors (Developer Mode) praten met een **publiek HTTPS** endpoint en willen OAuth 2.1 met dynamic client registration. Twee paden:

1. **Productie:** Cloudflare Worker als OAuth-gateway (`workers-oauth-provider`) die via cloudflared-tunnel naar deze bridge op de laptop/fleet routeert. Volgende slice.
2. **Dev-mode test:** OpenAI *Secure MCP Tunnel* (`tunnel-client`, outbound-only) kan de loopback-bridge direct exposeren — dev-mode only.

Tot die tijd: over Tailscale testen met een client die ruwe MCP over HTTP spreekt, of lokaal via `stdio`.
