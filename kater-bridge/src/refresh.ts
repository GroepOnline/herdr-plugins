#!/usr/bin/env node
import { execFileSync } from "child_process";
import * as path from "path";

const REFRESH_TIMEOUT_MS = 120000;

async function main() {
  const dir = path.dirname(process.argv[1] || __filename);
  const scripts = ["fleet-status.js", "pipeline.js", "pr-gate.js"];
  const failures: string[] = [];
  for (const script of scripts) {
    try {
      execFileSync("node", [path.join(dir, script)], {
        stdio: "inherit",
        env: process.env,
        timeout: REFRESH_TIMEOUT_MS,
      });
    } catch {
      failures.push(script);
      console.error(`kater-bridge refresh: ${script} failed (continuing)`);
    }
  }
  if (failures.length) {
    console.error(`kater-bridge refresh: failed child scripts: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

main();
