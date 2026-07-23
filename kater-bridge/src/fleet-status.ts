#!/usr/bin/env node
import { loadDotEnv, writeFragment, katerGet, PLUGIN_ID } from "./common";
import { katerCallTool } from "./mcp";

loadDotEnv();

type FleetNode = { name?: string; hostname?: string; status?: string; roles?: string[]; role?: string };
type FleetInventory = {
  nodes?: FleetNode[];
  node_count?: number;
  status_counts?: Record<string, number>;
  summary?: { total?: number; online?: number; offline?: number };
  error?: string;
};

function summarizeFleet(inventory: FleetInventory | null) {
  const nodes = inventory?.nodes || [];
  const okCount = inventory?.status_counts?.ok ?? nodes.filter(n => (n.status || "").toLowerCase() === "ok").length;
  const decommissioned = inventory?.status_counts?.decommissioned ?? nodes.filter(n => (n.status || "").toLowerCase() === "decommissioned").length;
  const total = inventory?.node_count ?? nodes.length;
  return {
    node_count: total,
    ok: okCount,
    decommissioned,
    nodes: nodes.slice(0, 12).map(n => ({
      name: n.hostname || n.name,
      status: n.status,
      role: n.role || (n.roles || []).join(", "),
    })),
  };
}

async function main() {
  const [health, status, inventory] = await Promise.all([
    katerGet<{ status?: string; version?: string; auth_mode?: string }>("/health", 15),
    katerGet<{
      version?: string;
      profile?: string;
      auth_mode?: string;
      servers?: { total?: number; enabled?: number; configured?: number; missing_env?: number };
      routing?: { events?: { total?: number; failed?: number } };
    }>("/api/status", 15),
    katerCallTool<FleetInventory>("utrecht_fleet_inventory", {}),
  ]);

  if (!health && !status && !inventory) {
    writeFragment(
      PLUGIN_ID,
      "kater",
      { error: `Kater gateway unreachable at ${process.env.KATER_API_URL || "http://127.0.0.1:9091"}` },
      30,
    );
    console.log("kater-bridge: gateway unreachable");
    return;
  }

  const ok = health?.status === "ok";
  const fleet = summarizeFleet(inventory);
  const data = {
    gateway_ok: ok,
    version: health?.version || status?.version || "",
    auth_mode: health?.auth_mode || status?.auth_mode || "",
    profile: status?.profile || "",
    servers: status?.servers || null,
    routing_events: status?.routing?.events || null,
    fleet,
    fleet_source: inventory ? "mcp:utrecht_fleet_inventory" : null,
  };
  const servers = status?.servers;
  const fleetBit = inventory ? ` · fleet ${fleet.ok}/${fleet.node_count} ok` : "";
  const display = ok
    ? `Kater OK ${data.profile}${servers ? ` · ${servers.configured}/${servers.total} servers` : ""}${fleetBit}`
    : "Kater gateway degraded";
  writeFragment(PLUGIN_ID, "kater", data, 60, display);
  console.log(`kater-bridge: ${display}`);
}

main();
