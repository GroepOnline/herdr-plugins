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
    const QUERY = `query($after: String) {\n  viewer {\n    assignedIssues(filter: { state: { type: { nin: ["completed", "canceled"] } } }, first: 50, after: $after) {\n      nodes { identifier title state { name } priority }\n      pageInfo { hasNextPage endCursor }\n    }\n  }\n}`;
    const MAX_PAGES = 20;
    const all: any[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: TOKEN },
        body: JSON.stringify({ query: QUERY, variables: { after } }),
      });
      let json: any;
      try {
        json = await res.json();
      } catch (e: any) {
        const message = `HTTP ${res.status}: invalid JSON response (${e?.message || e})`;
        writeFragment(PLUGIN_ID, "linear", { error: message }, 120);
        console.error(`linear-context: ${message}`);
        return;
      }
      const gqlErrors = json?.errors;
      if (gqlErrors && gqlErrors.length > 0) {
        const messages = gqlErrors.map((e: any) => e.message).join("; ");
        writeFragment(PLUGIN_ID, "linear", { error: `GraphQL: ${messages}`, gql_errors: gqlErrors }, 120);
        console.error(`linear-context: GraphQL error: ${messages}`);
        return;
      }
      if (!res.ok) {
        const message = `HTTP ${res.status} ${res.statusText}`.trim();
        writeFragment(PLUGIN_ID, "linear", { error: message }, 120);
        console.error(`linear-context: request failed: ${message}`);
        return;
      }
      const connection = json?.data?.viewer?.assignedIssues;
      const nodes = connection?.nodes;
      if (!Array.isArray(nodes)) {
        const message = "unexpected response shape: missing viewer.assignedIssues.nodes";
        writeFragment(PLUGIN_ID, "linear", { error: message }, 120);
        console.error(`linear-context: ${message}`);
        return;
      }
      all.push(...nodes);
      if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) break;
      after = connection.pageInfo.endCursor;
    }
    issues = all;
    cacheSet(cacheKey, issues, 120);
  }
  writeFragment(PLUGIN_ID, "linear", { assigned_open: issues.length, issues: issues.map((i: any) => ({ id: i.identifier, title: i.title, state: i.state?.name })) }, 120);
  console.log(`linear-context: ${issues.length} open issue(s) assigned to you`);
  for (const i of issues) console.log(`  ${i.identifier} [${i.state?.name}] ${i.title}`);
}
main();
