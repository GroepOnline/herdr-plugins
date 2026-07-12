#!/usr/bin/env node
const { writeFileSync, existsSync, mkdirSync } = require("fs");
const { join } = require("path");

const STATE_DIR = process.env.HERDR_PLUGIN_STATE_DIR || "/tmp/herdr-plugin-state";
const CONTEXT_JSON = process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}";
const EVENT = process.env.HERDR_PLUGIN_EVENT || "";
const LINEAR_API_KEY = process.env.LINEAR_API_KEY || "";

async function main() {
    const ctx = JSON.parse(CONTEXT_JSON);
    const branch = ctx.workspace_cwd || "";
    const issueMatch = branch.match(/([A-Z]+-\d+)/);

    mkdirSync(STATE_DIR, { recursive: true });

    if (!LINEAR_API_KEY) {
        const result = {
            plugin_id: "com.chefgroep.linear-context",
            component: "linear",
            data: { error: "LINEAR_API_KEY not set in .env" },
            fetched_at: Date.now(),
            ttl_seconds: 60,
        };
        writeFileSync(join(STATE_DIR, "fleet_ops.json"), JSON.stringify(result));
        console.log("linear-context: no API key configured");
        return;
    }

    const issueId = issueMatch ? issueMatch[1] : process.env.HERDR_PLUGIN_ACTION_ID ? ctx.focused_pane_agent : null;

    if (!issueId) {
        console.log("linear-context: no issue ID found in branch or context");
        return;
    }

    try {
        const query = `
            query { issue(id: "${issueId}") {
                title state { name } priority
                assignee { name }
                labels { nodes { name } }
                cycle { name }
                url
            }}`;

        const res = await fetch("https://api.linear.app/graphql", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": LINEAR_API_KEY,
            },
            body: JSON.stringify({ query }),
        });

        const json = await res.json();
        const issue = json.data?.issue;

        if (!issue) {
            console.log(`linear-context: issue ${issueId} not found`);
            return;
        }

        const result = {
            plugin_id: "com.chefgroep.linear-context",
            component: "linear",
            data: {
                issue_id: issueId,
                title: issue.title,
                state: issue.state?.name || "Unknown",
                assignee: issue.assignee?.name || "Unassigned",
                priority: issue.priority,
                labels: issue.labels?.nodes?.map(l => l.name) || [],
                cycle: issue.cycle?.name || "",
                url: issue.url,
            },
            fetched_at: Date.now(),
            ttl_seconds: 60,
        };

        writeFileSync(join(STATE_DIR, "fleet_ops.json"), JSON.stringify(result));
        console.log(`linear-context: ${issueId} — "${issue.title}" (${issue.state?.name})`);
    } catch (err) {
        console.error(`linear-context: fetch failed — ${err.message}`);
    }
}

main();
