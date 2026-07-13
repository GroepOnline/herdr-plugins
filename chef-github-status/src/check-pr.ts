#!/usr/bin/env node
import { loadDotEnv, writeFragment, getToken, cacheGet, cacheSet } from "./common";
import { execSync } from "child_process";

loadDotEnv();
const TOKEN = getToken("GITHUB_TOKEN", "GH_TOKEN");
const PLUGIN_ID = "com.chefgroep.github-status";
const HEADERS = TOKEN ? { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } : {};

function git(cmd) { try { return execSync(`git ${cmd}`, { encoding: "utf8" }).trim(); } catch { return ""; } }

const CI_ICON = { success: "OK", failure: "FAIL", running: "RUN", pending: "PEND", none: "-" };

async function main() {
  if (!TOKEN) {
    writeFragment(PLUGIN_ID, "github", { error: "GITHUB_TOKEN not configured - add it to the plugin config .env" }, 120);
    console.log("github-status: no GITHUB_TOKEN configured");
    return;
  }
  const remote = git("remote get-url origin").replace(/.*github\.com[:/]/, "").replace(/\.git$/, "");
  const [owner, repo] = (remote || "").split("/");
  const branch = git("branch --show-current");
  if (!owner || !repo) { console.log("github-status: not a GitHub repo"); return; }

  const cacheKey = `pr:${owner}:${repo}:${branch}`;
  let prs = cacheGet(cacheKey);
  if (!prs) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`, { headers: HEADERS });
    if (!res.ok) { writeFragment(PLUGIN_ID, "github", { error: `GitHub API ${res.status} ${res.statusText}` }, 30); console.log("github-status: API error", res.status); return; }
    prs = await res.json();
    cacheSet(cacheKey, prs, 30);
  }
  const pr = prs?.[0];
  if (!pr) { console.log(`github-status: no open PR for ${branch}`); writeFragment(PLUGIN_ID, "github", { repo: `${owner}/${repo}`, branch, pr: null }, 120); return; }

  const checksRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs`, { headers: HEADERS });
  const checks = (await checksRes.json()).check_runs || [];
  const ciStatus = checks.length === 0 ? "none"
    : checks.every(c => c.conclusion === "success") ? "success"
    : checks.some(c => c.conclusion === "failure") ? "failure"
    : checks.some(c => c.status === "in_progress") ? "running" : "pending";
  const icon = CI_ICON[ciStatus] || "-";

  const data = {
    repo: `${owner}/${repo}`,
    branch,
    pr_number: pr.number,
    pr_title: pr.title,
    draft: !!pr.draft,
    mergeable: pr.mergeable,
    review_state: pr.draft ? "draft" : "open",
    ci_status: ciStatus,
    ci_icon: icon,
    checks_total: checks.length,
    checks_failed: checks.filter(c => c.conclusion === "failure").length,
    head_sha: (pr.head.sha || "").substring(0, 7),
    base_branch: pr.base.ref,
    url: pr.html_url,
  };
  const display = `PR #${pr.number} ${icon} CI:${ciStatus}${data.checks_failed ? ` (${data.checks_failed} failed)` : ""} - ${pr.title}`;
  writeFragment(PLUGIN_ID, "github", data, 60, display);
  console.log(`github-status: ${display}`);
}
main();
