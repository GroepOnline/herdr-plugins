import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";

const stateDirs: string[] = [];

afterEach(() => {
  for (const dir of stateDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.HERDR_PLUGIN_STATE_DIR;
});

test("reclaims a dead lock before writing the merged fragment", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "kater-bridge-test-"));
  stateDirs.push(stateDir);
  process.env.HERDR_PLUGIN_STATE_DIR = stateDir;

  const lockPath = path.join(stateDir, ".fleet_ops.lock");
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 99999999, token: "dead-owner" }));

  const { writeFragment } = require("./common.js");
  writeFragment("test", "kater", { ok: true });

  const state = JSON.parse(fs.readFileSync(path.join(stateDir, "fleet_ops.json"), "utf8"));
  assert.equal(state.components.kater.plugin_id, "test");
  assert.equal(fs.existsSync(lockPath), false);
});
