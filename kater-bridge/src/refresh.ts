#!/usr/bin/env node
import { execSync } from "child_process";
import * as path from "path";

async function main() {
  const dir = path.dirname(process.argv[1] || __filename);
  const scripts = ["fleet-status.js", "pipeline.js", "pr-gate.js"];
  for (const script of scripts) {
    try {
      execSync(`node ${path.join(dir, script)}`, { stdio: "inherit", env: process.env });
    } catch {
      console.log(`kater-bridge refresh: ${script} failed (continuing)`);
    }
  }
}

main();
