#!/usr/bin/env node
import { loadDotEnv, writeFragment, PLUGIN_ID } from "./common";
import { katerCallTool } from "./mcp";

loadDotEnv();

const CTX = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}");

async function main() {
  const query = (process.env.KATER_QUERY || CTX.query || CTX.selection || "").trim();
  if (!query) {
    writeFragment(
      PLUGIN_ID,
      "kater-query",
      { error: "No query in pane context. Select text or set KATER_QUERY." },
      60,
    );
    console.log("kater-bridge: query action needs pane input");
    return;
  }

  const answer = await katerCallTool<Record<string, unknown>>("utrecht_ask", { question: query });
  if (!answer) {
    writeFragment(
      PLUGIN_ID,
      "kater-query",
      { query, error: "utrecht_ask MCP call failed (is Kater gateway running on :9090?)" },
      60,
      `Query failed: ${query.slice(0, 40)}`,
    );
    console.log("kater-bridge: utrecht_ask failed");
    return;
  }

  const text =
    typeof answer === "object" && answer !== null && "answer" in answer
      ? String((answer as { answer?: string }).answer || "")
      : JSON.stringify(answer).slice(0, 500);

  writeFragment(
    PLUGIN_ID,
    "kater-query",
    { query, answer: answer, answer_preview: text.slice(0, 280) },
    120,
    `Utrecht: ${text.slice(0, 56)}${text.length > 56 ? "…" : ""}`,
  );
  console.log(`kater-bridge: query answered (${text.length} chars)`);
}

main();
