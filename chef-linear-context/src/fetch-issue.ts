#!/usr/bin/env node
import { loadDotEnv, writeFragment, getToken, cacheGet, cacheSet } from "./common";

loadDotEnv();
const TOKEN = getToken("LINEAR_API_KEY");
const PLUGIN_ID = "com.chefgroep.linear-context";
const CTX = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}");

function extractIssueId() {
  const branch = CTX.workspace_cwd || "";
  const m = branch.match(/([A-Z]+-\d+)/);
  if (m) return m[1];
  const actionId = process.env.HERDR_PLUGIN_ACTION_ID || "";
  if (/^[A-Z]+-\d+$/.test(actionId)) return actionId;
  return process.env.LINEAR_ISSUE_ID || "";
}

async function gql(query, variables) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const PRIORITY = { 0: "None", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };

async function main() {
  const issueId = extractIssueId();
  if (!TOKEN) { writeFragment(PLUGIN_ID, "linear", { error: "LINEAR_API_KEY not set in plugin config .env" }, 120); console.log("linear-context: no API key"); return; }
  if (!issueId) { console.log("linear-context: no issue ID in branch or context"); writeFragment(PLUGIN_ID, "linear", { issue_id: null }, 120); return; }
  const cacheKey = `issue:${issueId}`;
  let issue = cacheGet(cacheKey);
  if (!issue) {
    const json = await gql(`query($id: String!) { issue(id: $id) { title state { name } priority assignee { name } labels { nodes { name } } cycle { name } team { key name } url } }`, { id: issueId });
    issue = json.data && json.data.issue;
    if (issue) cacheSet(cacheKey, issue, 120);
  }
  if (!issue) { console.log(`linear-context: issue ${issueId} not found`); writeFragment(PLUGIN_ID, "linear", { issue_id: issueId, error: "not found" }, 60); return; }
  const data = {
    issue_id: issueId,
    title: issue.title,
    state: (issue.state && issue.state.name) || "Unknown",
    priority: PRIORITY[issue.priority] != null ? PRIORITY[issue.priority] : issue.priority,
    assignee: (issue.assignee && issue.assignee.name) || "Unassigned",
    labels: (issue.labels && issue.labels.nodes || []).map(l => l.name),
    cycle: (issue.cycle && issue.cycle.name) || "",
    team: (issue.team && issue.team.key) || "",
    url: issue.url,
  };
  const display = `${issueId} - ${data.state} - ${data.assignee}${data.cycle ? ` - ${data.cycle}` : ""}`;
  writeFragment(PLUGIN_ID, "linear", data, 120, display);
  console.log(`linear-context: ${issueId} - "${issue.title}" (${data.state})`);
}
main();
