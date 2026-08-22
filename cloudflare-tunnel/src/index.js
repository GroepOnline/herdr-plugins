#!/usr/bin/env node
/**
 * com.chefgroep.cloudflare-tunnel
 *
 * Live tunnel + DNS health for the Fleet Ops Bar.
 * SSOT: HTTPS reachability of tunnel-backed hosts and real DNS answers.
 * No tokens needed; everything degrades to an explicit "unknown" instead of guessing.
 *
 * Env:
 *   HERDR_PLUGIN_STATE_DIR  state dir for fleet_ops.json (required, set by Herdr core)
 *   CHEF_TUNNEL_HOSTS       comma-separated hosts to probe
 *                           (default: herdr.chefgroep.nl,mcp.chefgroep.online,i.chefgroep.nl)
 */
import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { Resolver } from "node:dns/promises";
import path from "node:path";

const SOURCE = "cloudflare-tunnel";
const TTL_SECONDS = 300;
const PROBE_TIMEOUT_MS = 5_000;

const DEFAULT_HOSTS = "herdr.chefgroep.nl,i.chefgroep.nl";

function stateDir() {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!dir) throw new Error("HERDR_PLUGIN_STATE_DIR is required");
  return dir;
}

function configuredHosts() {
  const raw = process.env.CHEF_TUNNEL_HOSTS || DEFAULT_HOSTS;
  return raw
    .split(",")
    .map((h) => h.trim())
    .filter((h) => h && /^[a-z0-9.-]+$/i.test(h));
}

function fragment(cloudflare = {}) {
  return {
    source: SOURCE,
    updated_at: new Date().toISOString(),
    ttl_seconds: TTL_SECONDS,
    cloudflare: {
      tunnels_healthy: cloudflare.tunnels_healthy ?? null,
      summary: cloudflare.summary ?? "",
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

async function probeHost(host) {
  const started = Date.now();
  try {
    const res = await fetch(`https://${host}/`, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "user-agent": "chefgroep-herdr-plugin/0.2" },
    });
    // Any HTTP answer proves the tunnel + origin served us; body is irrelevant.
    return {
      host,
      ok: true,
      status: res.status,
      latency_ms: Date.now() - started,
      error: null,
    };
  } catch (err) {
    return {
      host,
      ok: false,
      status: null,
      latency_ms: null,
      error: err?.cause?.code || err?.name || String(err),
    };
  }
}

async function resolveHost(host) {
  const resolver = new Resolver({ timeout: PROBE_TIMEOUT_MS, tries: 2 });
  try {
    const addresses = await resolver.resolve4(host);
    return { host, resolved: addresses.length > 0, addresses, error: null };
  } catch (err) {
    return { host, resolved: false, addresses: [], error: err?.code || String(err) };
  }
}

function roundRatio(healthy, total) {
  return total === 0 ? null : Math.round((healthy / total) * 100) / 100;
}

async function main() {
  const action = process.argv[2] || "check-tunnels";
  const arg = process.argv[3] || "";

  switch (action) {
    case "check-tunnels":
    case "on-workspace-focused": {
      // Workspace focus is a heartbeat event, not a probe.  Do not write an
      // empty `tunnels: idle` fragment here: that would clobber a fresh live
      // result written by check-tunnels or check-dns.
      if (action === "on-workspace-focused") {
        console.log(JSON.stringify({ ok: true, action, heartbeat: true }));
        return;
      }

      const results = await Promise.all(configuredHosts().map(probeHost));
      const healthy = results.filter((r) => r.ok).length;
      const total = results.length;
      const summary = total === 0 ? "tunnels: idle" : `tunnels: ${healthy}/${total} healthy`;
      const data = fragment({
        tunnels_healthy: total === 0 ? null : roundRatio(healthy, total),
        summary,
      });
      const target = await writeFleetOps(data);
      console.log(JSON.stringify({ ok: true, action, path: target, cloudflare: data.cloudflare, results }));
      return;
    }

    case "check-dns":
    case "dig-probe": {
      const hosts = arg ? [arg] : configuredHosts();
      if (arg && !/^[a-z0-9.-]+$/i.test(arg)) {
        console.error(JSON.stringify({ ok: false, error: `invalid host: ${arg}` }));
        process.exitCode = 1;
        return;
      }
      const results = await Promise.all(hosts.map(resolveHost));
      const resolved = results.filter((r) => r.resolved).length;
      const data = fragment({
        tunnels_healthy: roundRatio(resolved, results.length),
        summary: `dns: ${resolved}/${results.length} resolved`,
      });
      const target = await writeFleetOps(data);
      console.log(JSON.stringify({ ok: true, action, path: target, cloudflare: data.cloudflare, results }));
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
