#!/usr/bin/env node
/** Smoke test: MCP tool round-trip against local Kater gateway (non-CI). */
import { loadDotEnv } from "./common";
import { katerCallTool } from "./mcp";

loadDotEnv();

async function main() {
  const profiles = await katerCallTool<{ profiles?: string[] }>("kater_profiles", {});
  if (!profiles) {
    console.error("FAIL: kater_profiles unreachable");
    process.exit(1);
  }
  console.log("OK kater_profiles", JSON.stringify(profiles).slice(0, 120));

  const inventory = await katerCallTool("utrecht_fleet_inventory", {});
  if (!inventory) {
    console.warn("WARN: utrecht_fleet_inventory unavailable (UDO profile may be offline)");
  } else {
    console.log("OK utrecht_fleet_inventory", JSON.stringify(inventory).slice(0, 120));
  }
}

main();
