---
name: fleet-health
description: Tailscale fleet scan + per-node SSH probes for herdr (writes fleet_ops.json). Use for fleet reachability checks from inside herdr.
---

# fleet-health

SSOT: live `tailscale status --json` + real SSH probes from this host. No
cached state, explicit degrade (`online: null` + reason) when tailscale is
missing.

## Invoke

```bash
herdr plugin action invoke com.chefgroep.fleet-health.scan-fleet   # peers online/total
herdr plugin action invoke com.chefgroep.fleet-health.scan-node    # one host (BatchMode, 5s timeout)
```

Probe actions atomically write `fleet_ops.json` (`ttl_seconds: 120`) under
`HERDR_PLUGIN_STATE_DIR`. The workspace-focus heartbeat writes nothing, so it
never overwrites fresh results.

## Requires

- `tailscale` on PATH (for `scan-fleet`)
- SSH BatchMode access to the target node (for `scan-node`)
- Node names are validated `[a-zA-Z0-9._-]` before ssh (array-args, no shell)
