import { createHash, randomUUID } from "node:crypto";

const TERMINAL_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const PANE_ID = /^[A-Za-z0-9_-]+:p[0-9]+$/;
const NOTIFY_STATUSES = new Set(["idle", "done", "blocked", "exited"]);
const ACTIVE_STATUSES = new Set(["working", "idle", "done", "blocked", "unknown"]);
const ADAPTERS = new Set(["pi", "codex"]);

export function newState() {
  return {
    version: 1,
    mode: "stopped",
    config_digest: null,
    members: {},
    transitions: {},
    next_transition_id: 1,
    pending: [],
    deliveries: [],
    audit: [],
    last_result: null,
  };
}

export function transitionMode(state, mode) {
  if (!new Set(["running", "paused", "stopped"]).has(mode)) throw new Error(`invalid mode: ${mode}`);
  state.mode = mode;
  if (mode === "stopped") state.pending = [];
  state.last_result = { result: mode, at: new Date().toISOString() };
  return state;
}

function assertString(value, label, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
  }
}

function validateSession(session, label) {
  if (session === undefined) return;
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    throw new Error(`${label}.agent_session must be an object`);
  }
  for (const key of ["source", "kind", "value"]) assertString(session[key], `${label}.agent_session.${key}`, 1000);
  if (!new Set(["id", "path"]).has(session.kind)) {
    throw new Error(`${label}.agent_session.kind must be id or path`);
  }
}

function validateMember(member, label, director = false) {
  if (!member || typeof member !== "object" || Array.isArray(member)) throw new Error(`${label} must be an object`);
  assertString(member.name, `${label}.name`, 80);
  assertString(member.pane_id, `${label}.pane_id`, 80);
  assertString(member.terminal_id, `${label}.terminal_id`, 160);
  if (!PANE_ID.test(member.pane_id)) throw new Error(`${label}.pane_id is invalid`);
  if (!TERMINAL_ID.test(member.terminal_id)) throw new Error(`${label}.terminal_id is invalid`);
  if (member.agent !== undefined) assertString(member.agent, `${label}.agent`, 80);
  validateSession(member.agent_session, label);
  if (director) {
    assertString(member.adapter, `${label}.adapter`, 40);
    if (!ADAPTERS.has(member.adapter)) throw new Error(`${label}.adapter must be pi or codex`);
    if (member.agent && member.agent !== member.adapter) throw new Error(`${label}.agent must match its delivery adapter`);
  } else {
    assertString(member.task, `${label}.task`, 500);
    if (member.evidence !== undefined) assertString(member.evidence, `${label}.evidence`, 1000);
  }
}

export function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("team config must be an object");
  if (config.version !== 1) throw new Error("team config version must be 1");
  assertString(config.campaign, "campaign", 120);
  assertString(config.owner, "owner", 80);
  validateMember(config.director, "director", true);
  if (!Array.isArray(config.workers) || config.workers.length === 0) throw new Error("workers must be a non-empty array");
  config.workers.forEach((worker, index) => validateMember(worker, `workers[${index}]`));
  const terminalIds = [config.director, ...config.workers].map((member) => member.terminal_id);
  if (new Set(terminalIds).size !== terminalIds.length) throw new Error("each team member must have a unique terminal_id");
  const names = [config.director, ...config.workers].map((member) => member.name);
  if (new Set(names).size !== names.length) throw new Error("each team member must have a unique name");
  const mode = config.delivery?.mode;
  if (!new Set(["preview", "live"]).has(mode)) throw new Error("delivery.mode must be preview or live");
  const coalesce = config.delivery?.coalesce_ms ?? 250;
  if (!Number.isInteger(coalesce) || coalesce < 0 || coalesce > 5000) {
    throw new Error("delivery.coalesce_ms must be an integer from 0 through 5000");
  }
  return config;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function configDigest(config) {
  return createHash("sha256").update(JSON.stringify(stable(config))).digest("hex");
}

function sameSession(expected, actual) {
  if (!expected) return true;
  return Boolean(actual) && expected.source === actual.source && expected.kind === actual.kind && expected.value === actual.value;
}

export function identityMatches(member, live) {
  return Boolean(live) && member.terminal_id === live.terminal_id &&
    (!member.agent || member.agent === live.agent) && sameSession(member.agent_session, live.agent_session);
}

function eventKind(envelope, fallback = "") {
  return String(envelope?.event || fallback).replaceAll(".", "_");
}

function eventPane(envelope) {
  return envelope?.data?.pane_id || envelope?.data?.pane?.pane_id || "";
}

function eventStatus(envelope, fallback = "") {
  const kind = eventKind(envelope, fallback);
  if (kind === "pane_exited") return "exited";
  return envelope?.data?.agent_status || "";
}

function trim(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function pushAudit(state, entry) {
  state.audit.push({ at: new Date().toISOString(), ...entry });
  state.audit = state.audit.slice(-100);
}

function memberFromLive(config, live) {
  if (!live?.terminal_id) return null;
  if (config.director.terminal_id === live.terminal_id) return { role: "director", member: config.director };
  const worker = config.workers.find((candidate) => candidate.terminal_id === live.terminal_id);
  return worker ? { role: "worker", member: worker } : null;
}

function memberFromKnownPane(config, state, paneId) {
  const known = Object.entries(state.members).find(([, value]) => value.pane_id === paneId);
  if (!known) return null;
  const [terminalId] = known;
  if (config.director.terminal_id === terminalId) return { role: "director", member: config.director };
  const worker = config.workers.find((candidate) => candidate.terminal_id === terminalId);
  return worker ? { role: "worker", member: worker } : null;
}

function rememberMember(state, member, live) {
  state.members[member.terminal_id] = {
    name: member.name,
    pane_id: live.pane_id,
    agent: live.agent || null,
    agent_session: live.agent_session || null,
    state_change_seq: Number(live.state_change_seq || 0),
    verified_at: new Date().toISOString(),
  };
}

function markDirectorProcessed(state, live) {
  const seq = Number(live?.state_change_seq || 0);
  if (live?.agent_status !== "working") return;
  for (const delivery of state.deliveries) {
    if (delivery.status === "submitted" && seq > Number(delivery.director_seq || 0)) {
      delivery.status = "processed";
      delivery.processed_at = new Date().toISOString();
      delivery.processed_seq = seq;
    }
  }
}

async function liveEventMember(config, state, client, kind, paneId) {
  let live = null;
  try {
    live = kind === "pane_exited" ? await client.getPane(paneId) : await client.getAgent(paneId);
  } catch {
    // An exited pane can be matched against its last verified terminal identity.
  }
  const resolved = memberFromLive(config, live) ||
    (kind === "pane_exited" ? memberFromKnownPane(config, state, paneId) : null);
  return { live, resolved };
}

function exitIdentityMatches(member, live, kind) {
  return kind === "pane_exited" && live && member.terminal_id === live.terminal_id &&
    (!live.agent || !member.agent || member.agent === live.agent) &&
    (!live.agent_session || sameSession(member.agent_session, live.agent_session));
}

function queueWorkerTransition(state, member, live, paneId, status, seq) {
  const previous = state.transitions[member.terminal_id];
  if (previous?.status === status && Number(previous.seq || 0) >= seq) {
    return { result: "ignored", reason: "duplicate", status, member: member.name };
  }
  state.transitions[member.terminal_id] = { status, seq, at: new Date().toISOString() };
  if (!NOTIFY_STATUSES.has(status)) return { result: "tracked", status, member: member.name };
  state.pending.push({
    id: `${member.terminal_id}:${state.next_transition_id}`,
    terminal_id: member.terminal_id,
    pane_id: live?.pane_id || paneId,
    worker: member.name,
    task: trim(member.task, 180),
    evidence: trim(member.evidence || `herdr agent read ${live?.pane_id || paneId}`, 220),
    status,
    seq,
    observed_at: new Date().toISOString(),
    claim_id: null,
  });
  state.next_transition_id += 1;
  state.pending = state.pending.slice(-100);
  return { result: "queued", status, member: member.name };
}

async function processEvent(config, state, envelope, client, fallbackEvent) {
  const kind = eventKind(envelope, fallbackEvent);
  if (!new Set(["pane_agent_status_changed", "pane_exited"]).has(kind)) {
    return { result: "ignored", reason: "irrelevant_event", event: kind };
  }
  if (state.mode !== "running") return { result: "ignored", reason: state.mode };
  const paneId = eventPane(envelope);
  if (!paneId) return { result: "ignored", reason: "missing_pane_id" };

  const { live, resolved } = await liveEventMember(config, state, client, kind, paneId);
  if (!resolved) {
    const configured = [config.director, ...config.workers].some((member) => member.pane_id === paneId);
    const reason = configured ? "stale_identity" : "unregistered_pane";
    pushAudit(state, { result: "ignored", reason, pane_id: paneId });
    return { result: "ignored", reason, pane_id: paneId };
  }
  const { role, member } = resolved;
  if (live && !identityMatches(member, live) && !exitIdentityMatches(member, live, kind)) {
    pushAudit(state, { result: "ignored", reason: "stale_identity", pane_id: paneId, member: member.name });
    return { result: "ignored", reason: "stale_identity", pane_id: paneId };
  }
  if (live) rememberMember(state, member, live);

  const status = eventStatus(envelope, fallbackEvent);
  const seq = Number(live?.state_change_seq || state.members[member.terminal_id]?.state_change_seq || 0);
  if (role === "director") {
    if (live) markDirectorProcessed(state, live);
    return { result: "ignored", reason: "director_event", status };
  }
  if (status !== "exited" && !ACTIVE_STATUSES.has(status)) {
    return { result: "ignored", reason: "irrelevant_status", status };
  }
  return queueWorkerTransition(state, member, live, paneId, status, seq);
}

export async function processEvents(config, state, envelopes, client, fallbackEvent = "") {
  const outcomes = [];
  for (const envelope of envelopes) outcomes.push(await processEvent(config, state, envelope, client, fallbackEvent));
  return outcomes;
}

function composerLine(screen, marker) {
  const lines = String(screen || "").replace(/\r/g, "").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(marker);
    if (match) return match[1].trim() ? "occupied" : "empty";
  }
  return "unknown";
}

export function inspectComposer(adapter, screen) {
  if (adapter === "pi") return composerLine(screen, /^\s*>\s?(.*)$/u);
  if (adapter === "codex") return composerLine(screen, /^\s*›\s?(.*)$/u);
  return "unsupported";
}

export function buildMessage(config, pending) {
  const rows = pending.map((item) =>
    `${item.worker}: ${item.status}; task=${trim(item.task, 120)}; evidence=${trim(item.evidence, 160)}`,
  );
  return trim([
    `[Herdr/${config.campaign}] ${pending.length} worker transition${pending.length === 1 ? "" : "s"}.`,
    ...rows,
    "Read the referenced evidence, distinguish idle from completion, update the checkpoint, and continue only within the registered campaign.",
  ].join("\n"), 1400);
}

export function recoverInterruptedDelivery(state) {
  const interrupted = new Set();
  for (const delivery of state.deliveries) {
    if (delivery.status === "submitting") {
      delivery.status = "ambiguous";
      delivery.blocked_reason = "restart_during_submission";
      interrupted.add(delivery.attempt_id);
    }
  }
  for (const pending of state.pending) {
    if (interrupted.has(pending.claim_id)) pending.ambiguous = true;
  }
  return interrupted.size;
}

export function releaseAmbiguous(state) {
  let released = 0;
  for (const pending of state.pending) {
    if (!pending.ambiguous) continue;
    pending.ambiguous = false;
    pending.claim_id = null;
    released += 1;
  }
  for (const delivery of state.deliveries) {
    if (delivery.status === "ambiguous") delivery.status = "retry_authorized";
  }
  return released;
}

async function saveResult(state, persist, result) {
  state.last_result = { ...result, at: new Date().toISOString() };
  await persist(state);
  return state.last_result;
}

async function inspectDirector(config, state, client) {
  const target = state.members[config.director.terminal_id]?.pane_id || config.director.pane_id;
  let director;
  try {
    director = await client.getAgent(target);
  } catch (error) {
    return { error: { result: "blocked", reason: "director_disconnected", detail: trim(error?.message, 200) } };
  }
  if (!identityMatches(config.director, director)) {
    return { error: { result: "blocked", reason: "stale_director_identity" } };
  }
  rememberMember(state, config.director, director);
  if (director.agent_status === "working") {
    return { error: { result: "queued", reason: "director_busy" } };
  }
  if (!new Set(["idle", "done"]).has(director.agent_status)) {
    return { error: { result: "blocked", reason: `director_${director.agent_status || "unknown"}` } };
  }
  try {
    const composer = inspectComposer(config.director.adapter, await client.readAgent(director.pane_id));
    if (composer === "empty") return { director };
    return { error: { result: "blocked", reason: composer === "occupied" ? "existing_user_input" : "input_state_unknown" } };
  } catch (error) {
    return { error: { result: "blocked", reason: "director_screen_unavailable", detail: trim(error?.message, 200) } };
  }
}

function claimDelivery(state, director) {
  const attemptId = randomUUID();
  const ids = state.pending.map((item) => item.id);
  for (const item of state.pending) item.claim_id = attemptId;
  const delivery = {
    attempt_id: attemptId,
    transition_ids: ids,
    status: "submitting",
    director_seq: Number(director.state_change_seq || 0),
    created_at: new Date().toISOString(),
  };
  state.deliveries.push(delivery);
  state.deliveries = state.deliveries.slice(-100);
  return { attemptId, ids, delivery };
}

async function submitDelivery(state, client, director, message, persist) {
  const { attemptId, ids, delivery } = claimDelivery(state, director);
  await persist(state);
  try {
    await client.promptAgent(director.pane_id, message);
    delivery.status = "submitted";
    delivery.submitted_at = new Date().toISOString();
    state.pending = state.pending.filter((item) => !ids.includes(item.id));
    return saveResult(state, persist, { result: "submitted", attempt_id: attemptId, count: ids.length });
  } catch (error) {
    delivery.status = "ambiguous";
    delivery.blocked_reason = trim(error?.message || "delivery failed", 200);
    for (const item of state.pending) {
      if (item.claim_id === attemptId) item.ambiguous = true;
    }
    return saveResult(state, persist, { result: "blocked", reason: "ambiguous_delivery", attempt_id: attemptId });
  }
}

export async function attemptDelivery(config, state, client, persist = async () => {}) {
  if (state.mode !== "running" || state.pending.length === 0) return { result: "noop" };
  if (state.pending.some((item) => item.ambiguous || item.claim_id)) {
    return saveResult(state, persist, { result: "blocked", reason: "ambiguous_delivery" });
  }
  const inspected = await inspectDirector(config, state, client);
  if (inspected.error) return saveResult(state, persist, inspected.error);
  const message = buildMessage(config, state.pending);
  if (config.delivery.mode === "preview") return saveResult(state, persist, { result: "preview", message });
  return submitDelivery(state, client, inspected.director, message, persist);
}

export async function verifyRegistration(config, client) {
  const members = [config.director, ...config.workers];
  const verified = [];
  for (const member of members) {
    const live = await client.getAgent(member.pane_id);
    if (!identityMatches(member, live)) throw new Error(`identity mismatch for ${member.name}`);
    verified.push(live);
  }
  return verified;
}
