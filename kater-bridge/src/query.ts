#!/usr/bin/env node
import { loadDotEnv, writeFragment, PLUGIN_ID } from "./common";

loadDotEnv();

const CTX = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}");

async function main() {
  const query = (process.env.KATER_QUERY || CTX.query || CTX.selection || "").trim();
  if (!query) {
    writeFragment(
      PLUGIN_ID,
      "kater-query",
      {
        error: "No query in pane context. Natural-language Utrecht queries require MCP (utrecht_ask) — not exposed on Kater REST in v0.1.",
      },
      60,
    );
    console.log("kater-bridge: query action needs pane input (MCP-only for Utrecht ask)");
    return;
  }

  writeFragment(
    PLUGIN_ID,
    "kater-query",
    {
      query,
      error: "Utrecht ask is MCP-only (utrecht_ask). Use Kater SSE gateway or REST doctor/status endpoints from this plugin.",
    },
    60,
    `Query pending MCP: ${query.slice(0, 48)}`,
  );
  console.log(`kater-bridge: query stub — MCP required for: ${query.slice(0, 80)}`);
}

main();
