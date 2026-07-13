#!/usr/bin/env node
import { loadDotEnv, writeFragment, getToken, cacheGet, cacheSet } from "./common";

loadDotEnv();
const TOKEN = getToken("LINEAR_API_KEY");
const PLUGIN_ID = "com.chefgroep.linear-context";

async function main() {
  if (!TOKEN) { writeFragment(PLUGIN_ID, "linear", { error: "LINEAR_API_KEY not set" }, 120); console.log("linear-context: no key"); return; }
  const cacheKey = "myissues";
  let issues = cacheGet(cacheKey);
  if (!issues) {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: TOKEN },
      body: JSON.stringify({ query: `query { issues(filter: { assignee: { isMe: true }, state: { type: { nin: [completed, canceled] } } }) { nodes { identifier title state { name } priority } } }` }),
    });
    const json = await res.json();
    issues = (json.data && json.data.issues && json.data.issues.nodes) || [];
    cacheSet(cacheKey, issues, 120);
  }
  writeFragment(PLUGIN_ID, "linear", { assigned_open: issues.length, issues: issues.map(i => ({ id: i.identifier, title: i.title, state: i.state && i.state.name })) }, 120);
  console.log(`linear-context: ${issues.length} open issue(s) assigned to you`);
  for (const i of issues) console.log(`  ${i.identifier} [${i.state && i.state.name}] ${i.title}`);
}
main();
