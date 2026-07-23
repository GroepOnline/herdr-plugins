#!/usr/bin/env node
import { loadDotEnv, writeFragment, katerGet, summarizeDoctor, summarizeFleet, PLUGIN_ID } from "./common";
import { katerCallTool } from "./mcp";

loadDotEnv();

async function main() {
  const [health, status, doctor, inventory] = await Promise.all([
    katerGet<{ status?: string; version?: string }>("/health", 15),
    katerGet<{ profile?: string; servers?: Record<string, number> }>("/api/status", 15),
    katerGet<{ findings?: Array<{ severity?: string; message?: string }> }>("/api/doctor", 30),
    katerCallTool<{ nodes?: Array<{ hostname?: string; name?: string; status?: string }>; node_count?: number; status_counts?: Record<string, number> }>("utrecht_fleet_inventory", {}),
  ]);

  const gatewayOk = health?.status === "ok";
  const findings = doctor?.findings || [];
  const summary = summarizeDoctor(findings);
  const fleet = summarizeFleet(inventory);

  const data = {
    gateway_ok: gatewayOk,
    version: health?.version || "",
    profile: status?.profile || "",
    servers: status?.servers || null,
    doctor: {
      findings_count: findings.length,
      severity_counts: summary.counts,
      top_findings: summary.top_messages,
    },
    fleet,
  };

  const fleetBit = inventory ? ` · ${fleet.ok}/${fleet.node_count} nodes ok` : "";
  const display = gatewayOk
    ? `Utrecht Fleet · Kater ${data.profile} · doctor ${findings.length} finding(s)${fleetBit}`
    : "Utrecht Fleet · Kater offline";

  writeFragment(PLUGIN_ID, "kater-dashboard", data, 90, display);
  console.log(`kater-bridge dashboard: ${display}`);
}

main();
