#!/usr/bin/env node
import { loadDotEnv, writeFragment, katerGet, summarizeDoctor, PLUGIN_ID } from "./common";

loadDotEnv();

async function main() {
  const doctor = await katerGet<{
    profiles?: string[];
    findings?: Array<{ code?: string; severity?: string; message?: string; suggested_action?: string }>;
  }>("/api/doctor", 30);

  if (!doctor) {
    writeFragment(PLUGIN_ID, "kater-doctor", { error: "Kater /api/doctor unreachable" }, 30);
    console.log("kater-bridge: doctor unreachable");
    return;
  }

  const findings = doctor.findings || [];
  const summary = summarizeDoctor(findings);
  const hasBlockers = findings.some(f => f.severity === "error");
  const hasWarnings = findings.some(f => f.severity === "warning");

  const data = {
    profiles: doctor.profiles || [],
    findings_count: findings.length,
    severity_counts: summary.counts,
    top_findings: summary.top_messages,
    findings: findings.slice(0, 10),
    healthy: !hasBlockers && !hasWarnings,
  };

  const display = hasBlockers
    ? `Kater doctor: ${summary.counts.error} error(s)`
    : hasWarnings
      ? `Kater doctor: ${summary.counts.warning} warning(s)`
      : "Kater doctor: OK";

  writeFragment(PLUGIN_ID, "kater-doctor", data, 120, display);
  console.log(`kater-bridge: ${display}`);
}

main();
