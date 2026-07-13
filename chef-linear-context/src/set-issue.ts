#!/usr/bin/env node
import { loadDotEnv, writeFragment, STATE_DIR } from "./common";
import * as fs from "fs";
import * as path from "path";
const CTX = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}");

loadDotEnv();
const PLUGIN_ID = "com.chefgroep.linear-context";

function main() {
  const branch = CTX.workspace_cwd || "";
  const m = branch.match(/([A-Z]+-\d+)/);
  const issueId = m ? m[1] : (process.argv[2] || "");
  if (!issueId) { console.log("linear-context: no issue ID found in branch"); return; }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const bindingPath = path.join(STATE_DIR, "linear-binding.json");
  const binding = JSON.parse(fs.existsSync(bindingPath) ? fs.readFileSync(bindingPath, "utf8") : "{}");
  binding.issue_id = issueId;
  binding.updated_at = Date.now();
  fs.writeFileSync(bindingPath, JSON.stringify(binding));
  writeFragment(PLUGIN_ID, "linear", { issue_id: issueId, bound: true }, 120, `Bound to ${issueId}`);
  console.log(`linear-context: workspace bound to ${issueId}`);
}
main();
