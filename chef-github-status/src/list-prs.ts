#!/usr/bin/env node
import { loadDotEnv, writeFragment, getToken, cacheGet, cacheSet, git, githubRepoFromRemote, contextCwd } from "./common";

loadDotEnv();
const TOKEN = getToken("GITHUB_TOKEN", "GH_TOKEN");
const PLUGIN_ID = "com.chefgroep.github-status";
const HEADERS = TOKEN ? { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } : {};


async function main() {
  if (!TOKEN) { writeFragment(PLUGIN_ID, "github", { error: "GITHUB_TOKEN not configured", cwd: contextCwd() }, 120); console.error("github-status: no token"); process.exitCode = 1; return; }
  const parsed = githubRepoFromRemote(git(["remote", "get-url", "origin"]));
  if (!parsed) { console.log(`github-status: not a GitHub repo (${contextCwd()})`); return; }
  const { owner, repo } = parsed;
  const cacheKey = `prs:${owner}:${repo}`;
  let prs = cacheGet(cacheKey);
  if (!prs) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=20`, { headers: HEADERS });
    if (!res.ok) { writeFragment(PLUGIN_ID, "github", { repo: `${owner}/${repo}`, cwd: contextCwd(), error: `GitHub API ${res.status}`, auth_hint: res.status === 404 ? "token may not have access to this repository" : null }, 30); console.error("github-status: API error", res.status, `${owner}/${repo}`); process.exitCode = 1; return; }
    prs = await res.json();
    cacheSet(cacheKey, prs, 60);
  }
  const list = (prs || []).map(p => ({ number: p.number, title: p.title, draft: !!p.draft, user: p.user && p.user.login, url: p.html_url, updated: p.updated_at }));
  writeFragment(PLUGIN_ID, "github", { repo: `${owner}/${repo}`, open_prs: list.length, prs: list }, 120);
  console.log(`github-status: ${list.length} open PR(s) in ${owner}/${repo}`);
  for (const p of list) console.log(`  #${p.number} ${p.draft ? "[draft] " : ""}${p.title}`);
}
main();
