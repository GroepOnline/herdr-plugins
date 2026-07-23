#!/usr/bin/env node
import { loadDotEnv, writeFragment, katerGet, summarizeDoctor, PLUGIN_ID } from "./common";
import { katerCallTool } from "./mcp";

loadDotEnv();

async function main() {
  const [doctor, pipeline, utrechtStatus] = await Promise.all([
    katerGet<{
      profiles?: string[];
      findings?: Array<{ code?: string; severity?: string; message?: string; suggested_action?: string }>;
    }>("/api/doctor", 30),
    katerCallTool<Record<string, unknown>>("utrecht_pipeline_status", {}),
    katerCallTool<Record<string, unknown>>("utrecht_status", {}),
  ]);

  if (!doctor && !pipeline && !utrechtStatus) {
    writeFragment(PLUGIN_ID, "kater-doctor", { error: "Kater doctor and Utrecht MCP tools unreachable" }, 30);
    console.log("kater-bridge: pipeline health unreachable");
    return;
  }

  const findings = doctor?.findings || [];
  const summary = summarizeDoctor(findings);
  const hasBlockers = findings.some(f => f.severity === "error");
  const hasWarnings = findings.some(f => f.severity === "warning");

  const data = {
    profiles: doctor?.profiles || [],
    findings_count: findings.length,
    severity_counts: summary.counts,
    top_findings: summary.top_messages,
    findings: findings.slice(0, 10),
    healthy: !hasBlockers && !hasWarnings,
    utrecht_pipeline: pipeline,
    utrecht_status: utrechtStatus,
    pipeline_source: pipeline ? "mcp:utrecht_pipeline_status" : null,
  };

  const pipeHint = pipeline && typeof pipeline === "object" && "status" in pipeline
    ? ` · pipeline ${String((pipeline as { status?: string }).status)}`
    : "";
  const display = hasBlockers
    ? `Kater doctor: ${summary.counts.error} error(s)${pipeHint}`
    : hasWarnings
      ? `Kater doctor: ${summary.counts.warning} warning(s)${pipeHint}`
      : `Kater doctor: OK${pipeHint}`;

  writeFragment(PLUGIN_ID, "kater-doctor", data, 120, display);
  console.log(`kater-bridge: ${display}`);
}

main();
