---
name: chatgpt-bridge
description: Expose herdr sessions/panes/agents as a local MCP endpoint for ChatGPT (read-only by default). Use when ChatGPT web/app needs visibility into herdr agents.
---

# chatgpt-bridge

One remote-MCP endpoint over the local herdr session, Desktop-Commander-style.
Zero deps (Node 20+ + `herdr` CLI only).

## Modes

```bash
node src/mcp-server.js serve     # Streamable HTTP op http://127.0.0.1:8791/mcp
node src/mcp-server.js stdio     # newline JSON-RPC on stdin/stdout
node src/mcp-server.js doctor    # tools + write-gate + herdr reachability
node src/mcp-server.js selftest  # redaction, pane validation, byte-cap
node src/mcp-server.js stop      # stop serve via pidfile
```

Run from the plugin root (managed checkout under
`~/.config/herdr/plugins/github/`).

## Tools (read)

`herdr_snapshot` (workspaces/tabs/panes/agents + status + cwd),
`herdr_read_agent` (recent terminal output of one agent/pane).

## Write-gate (closed by default)

`herdr_capture_agent`, `herdr_prompt_agent`, `herdr_notify` only exist when
`CHEF_CHATGPT_ALLOW_WRITE=1`. ChatGPT-side connection needs public HTTPS +
OAuth (roadmap: Cloudflare Worker gateway or OpenAI Secure MCP Tunnel);
until then: Tailscale + raw-MCP client, or local `stdio`.

## Config env

`CHEF_CHATGPT_PORT` (default `8791`, loopback-only), `CHEF_CHATGPT_TOKEN`
(Bearer when set), `CHEF_CHATGPT_ALLOW_WRITE` (off unless `1`).
