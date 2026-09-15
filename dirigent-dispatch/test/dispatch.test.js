import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { acquireLock, releaseLock } from "../src/index.js";
import {
  attemptDelivery,
  buildMessage,
  configDigest,
  identityMatches,
  inspectComposer,
  newState,
  processEvents,
  recoverInterruptedDelivery,
  releaseAmbiguous,
  transitionMode,
  validateConfig,
} from "../src/lib.js";

function config(overrides = {}) {
  return {
    version: 1,
    campaign: "release-42",
    owner: "Relay",
    director: {
      name: "Maestro",
      pane_id: "w1:p1",
      terminal_id: "term-director",
      agent: "pi",
      adapter: "pi",
      agent_session: { source: "herdr:pi", kind: "path", value: "/sessions/director.jsonl" },
    },
    workers: [
      {
        name: "Worker A",
        pane_id: "w1:p2",
        terminal_id: "term-worker-a",
        agent: "pi",
        agent_session: { source: "herdr:pi", kind: "path", value: "/sessions/worker-a.jsonl" },
        task: "build the bounded change",
        evidence: "/handoffs/worker-a.md",
      },
    ],
    delivery: { mode: "live", coalesce_ms: 0 },
    ...overrides,
  };
}

function agent(member, status, seq = 1, extra = {}) {
  return {
    pane_id: member.pane_id,
    terminal_id: member.terminal_id,
    agent: member.agent,
    agent_session: member.agent_session,
    agent_status: status,
    state_change_seq: seq,
    ...extra,
  };
}

function event(paneId, status, kind = "pane_agent_status_changed") {
  return {
    event: kind,
    data: {
      type: kind,
      pane_id: paneId,
      workspace_id: "w1",
      ...(kind === "pane_agent_status_changed" ? { agent_status: status, agent: "pi" } : {}),
    },
  };
}

function clientFor(cfg, { directorStatus = "idle", directorScreen = "\n >\n footer", promptError = null, workerIdentity = null } = {}) {
  const calls = [];
  return {
    calls,
    async getAgent(target) {
      if (target === cfg.director.pane_id) return agent(cfg.director, directorStatus, 20);
      if (target === cfg.workers[0].pane_id) return workerIdentity || agent(cfg.workers[0], "idle", 3);
      throw new Error("not found");
    },
    async getPane(target) {
      if (target === cfg.workers[0].pane_id) return workerIdentity || agent(cfg.workers[0], "unknown", 3);
      throw new Error("not found");
    },
    async readAgent() {
      return directorScreen;
    },
    async promptAgent(target, text) {
      calls.push({ target, text });
      if (promptError) throw promptError;
      return { type: "agent_prompted" };
    },
  };
}

function runningState(cfg) {
  const state = newState();
  state.mode = "running";
  state.config_digest = configDigest(cfg);
  return state;
}

describe("registration", () => {
  it("requires one owner and unique dynamic identities", () => {
    const cfg = config();
    assert.equal(validateConfig(cfg), cfg);
    assert.equal(validateConfig({ ...cfg, workers: [{ ...cfg.workers[0], pane_id: "w57:pC" }] }).workers[0].pane_id, "w57:pC");
    assert.equal(identityMatches(cfg.director, agent(cfg.director, "idle")), true);
    assert.throws(() => validateConfig({ ...cfg, owner: "" }), /owner/);
    assert.throws(() => validateConfig({ ...cfg, workers: [{ ...cfg.workers[0], terminal_id: cfg.director.terminal_id }] }), /unique terminal_id/);
  });
});

describe("event filtering and coalescing", () => {
  it("ignores irrelevant events", async () => {
    const cfg = config();
    const state = runningState(cfg);
    const outcomes = await processEvents(cfg, state, [{ event: "workspace_focused", data: {} }], clientFor(cfg));
    assert.equal(outcomes[0].reason, "irrelevant_event");
    assert.equal(state.pending.length, 0);
  });

  it("tracks working and bundles each meaningful idle/done transition once", async () => {
    const cfg = config();
    const state = runningState(cfg);
    let seq = 2;
    const client = clientFor(cfg);
    client.getAgent = async () => agent(cfg.workers[0], seq === 2 ? "working" : seq === 3 ? "idle" : "done", seq);
    await processEvents(cfg, state, [event("w1:p2", "working")], client);
    seq = 3;
    await processEvents(cfg, state, [event("w1:p2", "idle")], client);
    seq = 4;
    await processEvents(cfg, state, [event("w1:p2", "done")], client);
    assert.deepEqual(state.pending.map((item) => item.status), ["idle", "done"]);
    const duplicate = await processEvents(cfg, state, [event("w1:p2", "done")], client);
    assert.equal(duplicate[0].reason, "duplicate");
    assert.equal(state.pending.length, 2);
  });

  it("rejects a stale pane identity", async () => {
    const cfg = config();
    const state = runningState(cfg);
    const stale = agent(cfg.workers[0], "done", 8, { terminal_id: "term-reused" });
    const outcomes = await processEvents(cfg, state, [event("w1:p2", "done")], clientFor(cfg, { workerIdentity: stale }));
    assert.equal(outcomes[0].reason, "stale_identity");
    assert.equal(state.pending.length, 0);
  });

  it("accepts an exit only with current terminal and session evidence", async () => {
    const cfg = config();
    const state = runningState(cfg);
    await processEvents(cfg, state, [event("w1:p2", "", "pane_exited")], clientFor(cfg));
    assert.equal(state.pending[0].status, "exited");

    const unverifiable = runningState(cfg);
    const missingSession = agent(cfg.workers[0], "unknown", 3, { agent_session: undefined });
    const outcomes = await processEvents(cfg, unverifiable, [event("w1:p2", "", "pane_exited")], clientFor(cfg, { workerIdentity: missingSession }));
    assert.equal(outcomes[0].reason, "stale_identity");
    assert.equal(unverifiable.pending.length, 0);
  });

  it("uses director events only to acknowledge processing, never as worker notifications", async () => {
    const cfg = config();
    const state = runningState(cfg);
    state.deliveries.push({ status: "submitted", director_seq: 4 });
    const client = clientFor(cfg, { directorStatus: "working" });
    client.getAgent = async () => agent(cfg.director, "working", 5);
    const outcomes = await processEvents(cfg, state, [event("w1:p1", "working")], client);
    assert.equal(outcomes[0].reason, "director_event");
    assert.equal(state.deliveries[0].status, "processed");
    assert.equal(state.pending.length, 0);
  });
});

describe("delivery", () => {
  function pendingState(cfg) {
    const state = runningState(cfg);
    state.pending.push({
      id: "term-worker-a:3:done",
      terminal_id: "term-worker-a",
      pane_id: "w1:p2",
      worker: "Worker A",
      task: "build the bounded change",
      evidence: "/handoffs/worker-a.md",
      status: "done",
      seq: 3,
      claim_id: null,
    });
    return state;
  }

  it("queues while the director is busy", async () => {
    const cfg = config();
    const state = pendingState(cfg);
    const client = clientFor(cfg, { directorStatus: "working" });
    const result = await attemptDelivery(cfg, state, client);
    assert.deepEqual(result.result, "queued");
    assert.equal(client.calls.length, 0);
    assert.equal(state.pending.length, 1);
  });

  it("submits once to an idle director with an empty Pi composer", async () => {
    const cfg = config();
    const state = pendingState(cfg);
    const client = clientFor(cfg);
    const result = await attemptDelivery(cfg, state, client);
    assert.equal(result.result, "submitted");
    assert.equal(client.calls.length, 1);
    assert.equal(state.pending.length, 0);
    assert.match(client.calls[0].text, /Worker A: done/);
    assert.equal(state.deliveries[0].status, "submitted");
    await attemptDelivery(cfg, state, client);
    assert.equal(client.calls.length, 1);
  });

  it("preserves pending work when user input exists", async () => {
    const cfg = config();
    const state = pendingState(cfg);
    const client = clientFor(cfg, { directorScreen: "\n > /model\n footer" });
    const result = await attemptDelivery(cfg, state, client);
    assert.equal(result.reason, "existing_user_input");
    assert.equal(client.calls.length, 0);
    assert.equal(state.pending.length, 1);
  });

  it("keeps an ambiguous submission blocked across restart until explicit retry", async () => {
    const cfg = config();
    const state = pendingState(cfg);
    const client = clientFor(cfg, { promptError: new Error("socket disconnected") });
    await attemptDelivery(cfg, state, client);
    assert.equal(state.pending[0].ambiguous, true);
    assert.equal(state.deliveries[0].status, "ambiguous");
    assert.equal((await attemptDelivery(cfg, state, client)).reason, "ambiguous_delivery");
    assert.equal(releaseAmbiguous(state), 1);
    assert.equal(state.pending[0].claim_id, null);
  });

  it("recovers a crash during the submitting checkpoint without blind redelivery", () => {
    const cfg = config();
    const state = pendingState(cfg);
    state.pending[0].claim_id = "attempt-1";
    state.deliveries.push({ attempt_id: "attempt-1", status: "submitting" });
    assert.equal(recoverInterruptedDelivery(state), 1);
    assert.equal(state.pending[0].ambiguous, true);
    assert.equal(state.deliveries[0].status, "ambiguous");
  });

  it("keeps preview non-consuming", async () => {
    const cfg = config({ delivery: { mode: "preview", coalesce_ms: 0 } });
    const state = pendingState(cfg);
    const client = clientFor(cfg);
    const result = await attemptDelivery(cfg, state, client);
    assert.equal(result.result, "preview");
    assert.equal(state.pending.length, 1);
    assert.equal(client.calls.length, 0);
  });

  it("removes only transitions included in a size-bounded delivery", async () => {
    const cfg = config();
    const state = pendingState(cfg);
    for (let index = 0; index < 12; index += 1) {
      state.pending.push({
        ...state.pending[0],
        id: `extra-${index}`,
        worker: `worker-${index}`,
        task: "x".repeat(180),
        evidence: `/handoffs/${"y".repeat(180)}`,
      });
    }
    const client = clientFor(cfg);
    await attemptDelivery(cfg, state, client);
    assert.equal(client.calls.length, 1);
    assert.ok(client.calls[0].text.length <= 1400);
    assert.ok(state.pending.length > 0);
    assert.ok(state.pending.every((item) => !item.claim_id));
  });
});

describe("dispatch lock", () => {
  it("does not reap a live owner or release another owner's lease", async () => {
    const previous = process.env.HERDR_PLUGIN_STATE_DIR;
    const dir = await mkdtemp(path.join(os.tmpdir(), "dirigent-lock-"));
    process.env.HERDR_PLUGIN_STATE_DIR = dir;
    try {
      const lease = await acquireLock("dispatch.lock");
      const old = new Date(0);
      await utimes(lease.path, old, old);
      assert.equal(await acquireLock("dispatch.lock"), null);
      const ownerPath = path.join(lease.path, "owner.json");
      const owner = JSON.parse(await readFile(ownerPath, "utf8"));
      await writeFile(ownerPath, JSON.stringify({ ...owner, token: "replacement" }));
      await releaseLock(lease);
      assert.equal(JSON.parse(await readFile(ownerPath, "utf8")).token, "replacement");
    } finally {
      if (previous === undefined) delete process.env.HERDR_PLUGIN_STATE_DIR;
      else process.env.HERDR_PLUGIN_STATE_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("adapter boundary and controls", () => {
  it("recognizes empty and occupied Pi and Codex composers conservatively", () => {
    assert.equal(inspectComposer("pi", "answer\n >\n footer"), "empty");
    assert.equal(inspectComposer("pi", "answer\n > /m\n footer"), "occupied");
    assert.equal(inspectComposer("codex", "answer\n ›\n tokens"), "empty");
    assert.equal(inspectComposer("codex", "answer\n › queued text\n tokens"), "occupied");
    assert.equal(inspectComposer("cursor", ">"), "unsupported");
    assert.equal(inspectComposer("pi", "no composer"), "unknown");
  });

  it("pauses without consuming and stops by discarding pending work", async () => {
    const cfg = config();
    const state = runningState(cfg);
    state.pending.push({ id: "one" });
    transitionMode(state, "paused");
    await processEvents(cfg, state, [event("w1:p2", "done")], clientFor(cfg));
    assert.equal(state.pending.length, 1);
    transitionMode(state, "stopped");
    assert.equal(state.pending.length, 0);
  });

  it("builds a compact evidence-only message", () => {
    const cfg = config();
    const text = buildMessage(cfg, [{ worker: "A", status: "idle", task: "task", evidence: "/handoff", terminal_id: "t" }]);
    assert.match(text, /A: idle/);
    assert.match(text, /distinguish idle from completion/);
    assert.ok(text.length <= 1400);
  });
});
