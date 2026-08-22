#!/usr/bin/env node
/**
 * com.chefgroep.fleet-health
 *
 * Tailscale fleet + per-node SSH health for the Fleet Ops Bar.
 * SSOT: `tailscale status` and real SSH probes on this host. No cached state.
 *
 * Env:
 *   HERDR_PLUGIN_STATE_DIR  state dir for fleet_ops.json (required, set by Herdr core)
 */
import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE = "fleet-health";
const TTL_SECONDS = 120;
const TS_TIMEOUT_MS = 5_000;
const SSH_TIMEOUT_MS = 8_000;

function stateDir() {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!dir) throw new Error("HERDR_PLUGIN_STATE_DIR is required");
  return dir;
}

function fragment(fleet = {}) {
  return {
    source: SOURCE,
    updated_at: new Date().toISOString(),
    ttl_seconds: TTL_SECONDS,
    fleet: {
      online: fleet.online ?? null,
      total: fleet.total ?? null,
      summary: fleet.summary ?? "",
    },
  };
}

async function writeFleetOps(data) {
  const dir = stateDir();
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, "fleet_ops.json");
  // Atomic write so the Fleet Ops Bar never reads a partial file.
  const tmp = path.join(dir, `fleet_ops.json.${process.pid}.tmp`);
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, target);
  return target;
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ err, stdout, stderr }),
    );
  });
}

function validNodeName(node) {
  return /^[a-zA-Z0-9._-]+$/.test(node);
}

async function scanFleet() {
  const { err, stdout } = await run(
    "tailscale",
    ["status", "--json"],
    TS_TIMEOUT_MS,
  );
  if (err) {
    return {
      degraded: true,
      reason: err.code === "ENOENT" ? "tailscale not installed" : String(err.message || err),
      results: [],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { degraded: true, reason: "tailscale status returned invalid JSON", results: [] };
  }
  const peers = Object.values(parsed.Peer || {});
  const results = peers.map((p) => ({
    node: p.HostName || p.DNSName || p.TailscaleIPs?.[0] || "unknown",
    online: Boolean(p.Online),
  }));
  results.sort((a, b) => a.node.localeCompare(b.node));
  return { degraded: false, reason: null, results };
}

async function scanNode(node) {
  const started = Date.now();
  const { err } = await run(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", node, "echo ok"],
    SSH_TIMEOUT_MS,
  );
  return {
    node,
    reachable: !err,
    latency_ms: err ? null : Date.now() - started,
    error: err ? String(err.message || err).split("\n")[0] : null,
  };
}

async function main() {
  const action = process.argv[2] || "scan-fleet";
  const node = process.argv[3] || "";

  switch (action) {
    case "scan-fleet":
    case "on-workspace-focused": {
      // Workspace focus is a heartbeat event, not a probe.  Do not write a
      // degraded empty fragment here: that would clobber a fresh live result
      // written by scan-fleet or scan-node.
      if (action === "on-workspace-focused") {
        console.log(JSON.stringify({ ok: true, action, heartbeat: true }));
        return;
      }

      const scan = await scanFleet();
      const online = scan.results.filter((r) => r.online).length;
      const total = scan.results.length;
      const summary = scan.degraded
        ? `fleet scan unavailable: ${scan.reason}`
        : `fleet: ${online}/${total} online`;
      const data = fragment({
        online: scan.degraded ? null : online,
        total: scan.degraded ? null : total,
        summary,
      });
      const target = await writeFleetOps(data);
      console.log(JSON.stringify({ ok: true, action, path: target, fleet: data.fleet, results: scan.results }));
      return;
    }

    case "scan-node": {
      if (!node || !validNodeName(node)) {
        console.error(JSON.stringify({ ok: false, error: "scan-node requires a hostname (letters, digits, dot, dash, underscore)" }));
        process.exitCode = 1;
        return;
      }
      const result = await scanNode(node);
      const data = fragment({
        summary: result.reachable ? `${node}: reachable (${result.latency_ms}ms)` : `${node}: unreachable`,
      });
      const target = await writeFleetOps(data);
      console.log(JSON.stringify({ ok: true, action, path: target, fleet: data.fleet, result }));
      return;
    }

    default:
      console.error(JSON.stringify({ ok: false, error: `unknown action: ${action}` }));
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exitCode = 1;
});
