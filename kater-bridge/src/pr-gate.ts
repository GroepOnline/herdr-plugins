#!/usr/bin/env node
import { loadDotEnv, writeFragment, katerFetch, git, PLUGIN_ID } from "./common";

loadDotEnv();

type Pull = {
  number: number;
  title?: string;
  head_ref?: string;
  head_sha?: string;
  merge_ready?: boolean;
};

type PrList = { pulls?: Pull[]; count?: number; error?: string };
type PrGate = {
  verdict?: string;
  merge_ready?: boolean;
  head_sha?: string;
  reasons?: string[];
  error?: string;
};

async function main() {
  const branch = git("branch --show-current");
  const listRes = await katerFetch<PrList>("/api/pr/list?state=open&limit=20", 20);

  if (!listRes.data && listRes.status === 0) {
    writeFragment(PLUGIN_ID, "kater-pr", { error: "Kater /api/pr/list unreachable" }, 30);
    console.error("kater-bridge: pr-gate list unreachable");
    process.exitCode = 1;
    return;
  }

  const list = listRes.data;
  if (!listRes.ok || list?.error) {
    const err = list?.error || `Kater /api/pr/list HTTP ${listRes.status}`;
    writeFragment(PLUGIN_ID, "kater-pr", { error: err, branch, http_status: listRes.status }, 30);
    console.error("kater-bridge: pr-gate list error", err);
    process.exitCode = 1;
    return;
  }

  const pulls = list?.pulls || [];

  if (!branch) {
    writeFragment(
      PLUGIN_ID,
      "kater-pr",
      { error: "Cannot determine current git branch (detached HEAD or outside repo)", open_count: pulls.length },
      30,
      "PR gate: no git branch",
    );
    console.log("kater-bridge: pr-gate skipped (no git branch)");
    return;
  }

  const pr = pulls.find(p => p.head_ref === branch);

  if (!pr) {
    writeFragment(PLUGIN_ID, "kater-pr", { branch, pr: null, open_count: pulls.length }, 60);
    console.log(`kater-bridge: no open PR for branch ${branch || "(none)"}`);
    return;
  }

  const expected = pr.head_sha || "";
  const gatePath = expected
    ? `/api/pr/${pr.number}/gate?expected_head_sha=${encodeURIComponent(expected)}`
    : `/api/pr/${pr.number}/gate`;
  const gateRes = await katerFetch<PrGate>(gatePath, 20);
  const gate = gateRes.data;

  if (!gateRes.ok || !gate) {
    const err = gate?.error ?? (gateRes.status ? `Kater gate HTTP ${gateRes.status}` : "Kater gate unreachable");
    writeFragment(
      PLUGIN_ID,
      "kater-pr",
      { branch, pr_number: pr.number, pr_title: pr.title, error: err, http_status: gateRes.status },
      30,
      `PR #${pr.number} gate ERROR`,
    );
    console.error(`kater-bridge: PR #${pr.number} gate error`, err);
    process.exitCode = 1;
    return;
  }

  const verdict =
    gate.verdict ||
    (gate.merge_ready === true ? "PASS" : gate.merge_ready === false ? "FAIL" : gate.error ? "ERROR" : "ERROR");
  const data = {
    branch,
    pr_number: pr.number,
    pr_title: pr.title,
    head_sha: (pr.head_sha || gate?.head_sha || "").slice(0, 7),
    verdict,
    merge_ready: gate?.merge_ready ?? pr.merge_ready ?? null,
    reasons: gate?.reasons || [],
    error: gate?.error || null,
    open_count: pulls.length,
  };

  const display = `PR #${pr.number} gate ${verdict}${data.error ? ` (${String(data.error).slice(0, 40)})` : ""}`;
  writeFragment(PLUGIN_ID, "kater-pr", data, 60, display);
  console.log(`kater-bridge: ${display}`);
}

main();
