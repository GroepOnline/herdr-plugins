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
      body: JSON.stringify({
        query: `query {\n  viewer {\n    assignedIssues(filter: { state: { type: { nin: ["completed", "canceled"] } } }, first: 50) {\n      nodes { identifier title state { name } priority }\n    }\n  }\n}`,
      }),
    });
    const json = await res.json();
    const gqlErrors = json.errors;
    if (gqlErrors && gqlErrors.length > 0) {
      const messages = gqlErrors.map((e: any) => e.message).join("; ");
      writeFragment(PLUGIN_ID, "linear", { error: `GraphQL: ${messages}`, gql_errors: gqlErrors }, 120);
      console.error(`linear-context: GraphQL error — ${messages}`);
      return;
    }
    issues = (json.data?.viewer?.assignedIssues?.nodes) || [];
    cacheSet(cacheKey, issues, 120);
  }
  writeFragment(PLUGIN_ID, "linear", { assigned_open: issues.length, issues: issues.map((i: any) => ({ id: i.identifier, title: i.title, state: i.state?.name })) }, 120);
  console.log(`linear-context: ${issues.length} open issue(s) assigned to you`);
  for (const i of issues) console.log(`  ${i.identifier} [${i.state?.name}] ${i.title}`);
}
main();
