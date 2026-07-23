#!/usr/bin/env node
import { loadDotEnv, writeFragment, katerGet, PLUGIN_ID } from "./common";

loadDotEnv();

async function main() {
  const health = await katerGet<{ status?: string; version?: string; auth_mode?: string }>("/health", 15);
  const status = await katerGet<{
    version?: string;
    profile?: string;
    auth_mode?: string;
    servers?: { total?: number; enabled?: number; configured?: number; missing_env?: number };
    routing?: { events?: { total?: number; failed?: number } };
  }>("/api/status", 15);

  if (!health && !status) {
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
  const data = {
    gateway_ok: ok,
    version: health?.version || status?.version || "",
    auth_mode: health?.auth_mode || status?.auth_mode || "",
    profile: status?.profile || "",
    servers: status?.servers || null,
    routing_events: status?.routing?.events || null,
  };
  const servers = status?.servers;
  const display = ok
    ? `Kater OK ${data.profile}${servers ? ` · ${servers.configured}/${servers.total} servers` : ""}`
    : "Kater gateway degraded";
  writeFragment(PLUGIN_ID, "kater", data, 60, display);
  console.log(`kater-bridge: ${display}`);
}

main();
