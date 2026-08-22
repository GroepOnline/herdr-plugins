#!/usr/bin/env node
/**
 * com.chefgroep.udo-metrics
 *
 * Host metrics from Utrecht Data OS nodes for the Fleet Ops Bar.
 * SSOT: live load/uptime read over SSH on each node. No cached state, no tokens.
 *
 * Env:
 *   HERDR_PLUGIN_STATE_DIR  state dir for fleet_ops.json (required, set by Herdr core)
 *   CHEF_UDO_NODES          comma-separated node hostnames to refresh
 *                           (e.g. bc-scan-arm,bc-scan-2,chef-control-01)
 */
import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE = "udo-metrics";
const TTL_SECONDS = 60;
const SSH_TIMEOUT_MS = 8_000;

function stateDir() {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!dir) throw new Error("HERDR_PLUGIN_STATE_DIR is required");
  return dir;
}

function configuredNodes() {
  return (process.env.CHEF_UDO_NODES || "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => /^[a-zA-Z0-9._-]+$/.test(n));
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
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => resolve({ err, stdout, stderr }),
    );
  });
}

// Reads load1 + human uptime in one SSH round-trip; both files are world-readable.
async function fetchNode(node) {
  const { err, stdout } = await run(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", node, "cat /proc/loadavg; uptime -p"],
    SSH_TIMEOUT_MS,
  );
  if (err) {
    return {
      node,
      reachable: false,
      load1: null,
      uptime: null,
      error: String(err.message || err).split("\n")[0],
    };
  }
  const [loadLine = "", uptimeLine = ""] = stdout.trim().split("\n");
  const load1 = Number.parseFloat(loadLine.split(/\s+/)[0]);
  return {
    node,
    reachable: true,
    load1: Number.isFinite(load1) ? load1 : null,
    uptime: uptimeLine.trim() || null,
    error: null,
  };
}

async function main() {
  const action = process.argv[2] || "refresh-metrics";
  const nodeArg = process.argv[3] || "";

  switch (action) {
    case "refresh-metrics":
    case "on-workspace-focused": {
      const nodes =
        action === "refresh-metrics" ? configuredNodes() : [];
      if (action === "refresh-metrics" && nodes.length === 0) {
        const data = fragment({ summary: "udo metrics: set CHEF_UDO_NODES" });
        const target = await writeFleetOps(data);
        console.log(JSON.stringify({ ok: true, action, path: target, fleet: data.fleet, results: [] }));
        return;
      }
      const results = await Promise.all(nodes.map(fetchNode));
      const reachable = results.filter((r) => r.reachable).length;
      const data = fragment({
        online: results.length ? reachable : null,
        total: results.length || null,
        summary:
          results.length === 0
            ? "udo metrics: idle"
            : `udo: ${reachable}/${results.length} nodes reporting`,
      });
      const target = await writeFleetOps(data);
      console.log(JSON.stringify({ ok: true, action, path: target, fleet: data.fleet, results }));
      return;
    }

    case "fetch-node": {
      if (!nodeArg || !/^[a-zA-Z0-9._-]+$/.test(nodeArg)) {
        console.error(JSON.stringify({ ok: false, error: "fetch-node requires a hostname (letters, digits, dot, dash, underscore)" }));
        process.exitCode = 1;
        return;
      }
      const result = await fetchNode(nodeArg);
      const data = fragment({
        summary: result.reachable
          ? `${nodeArg}: load ${result.load1 ?? "?"}`
          : `${nodeArg}: unreachable`,
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
