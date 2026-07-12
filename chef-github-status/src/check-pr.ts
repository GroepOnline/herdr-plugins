#!/usr/bin/env node
const { writeFileSync, existsSync, mkdirSync, readFileSync } = require("fs");
const { join } = require("path");
const { execSync } = require("child_process");

const STATE_DIR = process.env.HERDR_PLUGIN_STATE_DIR || "/tmp/herdr-plugin-state";
const CONTEXT_JSON = process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}";
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

function git(cmd) {
    try { return execSync(`git ${cmd}`, { cwd: process.cwd(), encoding: "utf8" }).trim(); }
    catch { return ""; }
}

async function main() {
    mkdirSync(STATE_DIR, { recursive: true });

    if (!GH_TOKEN) {
        writeFileSync(join(STATE_DIR, "fleet_ops.json"), JSON.stringify({
            plugin_id: "com.chefgroep.github-status",
            component: "github",
            data: { error: "GITHUB_TOKEN not configured" },
            fetched_at: Date.now(),
            ttl_seconds: 30,
        }));
        console.log("github-status: no GITHUB_TOKEN configured");
        return;
    }

    const remote = git("remote get-url origin")
        .replace(/.*github\.com[:/]/, "")
        .replace(/\.git$/, "");
    const [owner, repo] = remote.split("/");
    const branch = git("branch --show-current");

    if (!owner || !repo) {
        console.log("github-status: not a GitHub repo");
        return;
    }

    const headers = {
        "Authorization": `Bearer ${GH_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };

    try {
        const prRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`,
            { headers }
        );
        const prs = await prRes.json();
        const pr = prs?.[0];

        if (!pr) {
            console.log(`github-status: no open PR for ${branch}`);
            return;
        }

        const checksRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs`,
            { headers }
        );
        const checks = (await checksRes.json()).check_runs || [];
        const ciStatus = checks.every(c => c.conclusion === "success") ? "success"
            : checks.some(c => c.conclusion === "failure") ? "failure"
            : checks.some(c => c.status === "in_progress") ? "running"
            : "pending";

        const result = {
            plugin_id: "com.chefgroep.github-status",
            component: "github",
            data: {
                repo: `${owner}/${repo}`,
                pr_number: pr.number,
                pr_title: pr.title,
                mergeable: pr.mergeable,
                review_state: pr.draft ? "draft" : "open",
                ci_status: ciStatus,
                head_sha: pr.head.sha?.substring(0, 7),
                base_branch: pr.base.ref,
                url: pr.html_url,
            },
            fetched_at: Date.now(),
            ttl_seconds: 30,
        };

        writeFileSync(join(STATE_DIR, "fleet_ops.json"), JSON.stringify(result));
        console.log(`github-status: PR #${pr.number} "${pr.title}" — CI: ${ciStatus}`);
    } catch (err) {
        console.error(`github-status: fetch failed — ${err.message}`);
    }
}

main();
