#!/usr/bin/env node
/**
 * com.chefgroep.issue-provision
 *
 * Tracks workspaces provisioned from Linear issues for the Fleet Ops Bar.
 * SSOT: the provisioned.json ledger in the plugin state dir + Linear issue ids.
 *
 * Env:
 *   HERDR_PLUGIN_STATE_DIR   state dir for fleet_ops.json + provisioned.json (required)
 *   HERDR_LINEAR_ISSUE_ID    fallback issue id, e.g. GRO-123
 *   HERDR_PLUGIN_CLICKED_URL Linear issue URL from a link_handler click
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE = "issue-provision";
const TTL_SECONDS = 60;
const LEDGER = "provisioned.json";

function stateDir() {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!dir) throw new Error("HERDR_PLUGIN_STATE_DIR is required");
  return dir;
}

function issueIdFromClickedUrl() {
  const url = process.env.HERDR_PLUGIN_CLICKED_URL || "";
  const match = url.match(/issue\/([A-Z]+-\d+)/i);
  return match ? match[1].toUpperCase() : "";
}

function resolveIssueId(arg) {
  const raw = arg || process.env.HERDR_LINEAR_ISSUE_ID || issueIdFromClickedUrl() || "";
  const m = raw.toUpperCase().match(/^([A-Z]+-\d+)$/);
  return m ? m[1] : "";
}

async function readLedger(dir) {
  try {
    const raw = await readFile(path.join(dir, LEDGER), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLedger(dir, entries) {
  // Atomic write so readers never observe a partial ledger.
  const tmp = path.join(dir, `${LEDGER}.${process.pid}.tmp`);
  await writeFile(tmp, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  await rename(tmp, path.join(dir, LEDGER));
}

function fragment(issue = {}) {
  return {
    source: SOURCE,
    updated_at: new Date().toISOString(),
    ttl_seconds: TTL_SECONDS,
    issue: { id: "", title: "", status: "", assignee: "", cycle: "", ...issue },
  };
}

async function writeFleetOps(data) {
  const dir = stateDir();
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, "fleet_ops.json");
  const tmp = path.join(dir, `fleet_ops.json.${process.pid}.tmp`);
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, target);
  return target;
}

async function main() {
  const action = process.argv[2] || "provision";
  const issueId = resolveIssueId(process.argv[3]);

  switch (action) {
    case "provision":
    case "teardown": {
      if (!issueId) {
        console.error(
          JSON.stringify({
            ok: false,
            error: "provide an issue id like GRO-123 (arg, HERDR_LINEAR_ISSUE_ID, or a Linear issue link)",
          }),
        );
        process.exitCode = 1;
        return;
      }
      const dir = stateDir();
      await mkdir(dir, { recursive: true });
      let entries = await readLedger(dir);
      if (action === "provision") {
        const entry = { id: issueId, provisioned_at: new Date().toISOString() };
        entries = [...entries.filter((e) => e.id !== issueId), entry];
      } else {
        const before = entries.length;
        entries = entries.filter((e) => e.id !== issueId);
        if (entries.length === before) {
          console.error(JSON.stringify({ ok: false, error: `${issueId} is not provisioned` }));
          process.exitCode = 1;
          return;
        }
      }
      await writeLedger(dir, entries);
      const data = fragment({ id: issueId, status: action });
      const target = await writeFleetOps(data);
      console.log(JSON.stringify({ ok: true, action, path: target, issue: data.issue, provisioned: entries.map((e) => e.id) }));
      return;
    }

    case "list-provisioned": {
      const dir = stateDir();
      const entries = await readLedger(dir);
      const data = fragment(
        entries.length > 0
          ? { id: entries[entries.length - 1].id, status: "provisioned" }
          : {},
      );
      const target = await writeFleetOps(data);
      console.log(JSON.stringify({ ok: true, action, path: target, issue: data.issue, provisioned: entries }));
      return;
    }

    default:
      console.error(JSON.stringify({ ok: false, error: `unknown action: ${action}` }));
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exitCode = 1;
});
