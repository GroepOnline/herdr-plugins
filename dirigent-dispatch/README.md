# Dirigent Dispatch

Routes registered worker lifecycle transitions to one registered coordinating agent. Filtering, deduplication, coalescing, and durable bookkeeping use Herdr event hooks and local files only. A model turn can start only when a compact message is submitted to the director.

The plugin is inert after installation. It must be configured and explicitly started. Start with `delivery.mode: "preview"`; changing to `"live"` requires running `start` again.

## Why this is a separate plugin

| Existing plugin | Current authority | Overlap decision |
| --- | --- | --- |
| Session Parking | Parked-session records and Fleet Ops summary | Reuse its lifecycle event source, not its state or `resume` action. `resume` only removes a parking record. |
| Pane Exit Reaper | Cleanup after `pane.exited` | Keep cleanup separate from agent input. Both may receive the same exit event. |
| GitHub PR/CI Status | PR checks on `worktree.opened` | No worker lifecycle or verified wake path to reuse. |
| Linear Context and Issue Provision | Work-item context and workspace ledger | Keep task metadata separate; dispatch stores only a compact task/evidence reference. |
| Herdr Ops and Fleet/Kater/Cloudflare plugins | Runtime and health summaries | No session authority or agent delivery added. |
| ChatGPT Bridge | Explicit remote read/write MCP tools | Its opt-in write gate is not a background team scheduler. |
| Cline integration | Cline-specific launch and lifecycle reporting | Treat reported status as input; do not import its harness controls. |
| UDO Metrics | Disabled infrastructure metrics | Remains disabled and out of scope. |
| Dirigent Dispatch | Team registration, event filtering, pending delivery and one director prompt | New narrow authority; it does not park, reap, poll CI, start agents, or change models. |

No existing plugin implements the missing worker-event to director-delivery state machine, so merging it into Session Parking would couple unrelated lifecycle ownership.

## Registration

Create `team.json` under Herdr's plugin config directory, normally:

```text
~/.config/herdr/plugins/config/com.chefgroep.dirigent-dispatch/team.json
```

Use current values from `herdr agent get <target>`; do not copy the example identities:

```json
{
  "version": 1,
  "campaign": "release-42",
  "owner": "one-human-or-agent-owner",
  "director": {
    "name": "chosen-director",
    "pane_id": "wA:p1",
    "terminal_id": "term_current_director",
    "agent": "pi",
    "adapter": "pi",
    "agent_session": {
      "source": "herdr:pi",
      "kind": "path",
      "value": "/current/session.jsonl"
    }
  },
  "workers": [
    {
      "name": "worker-one",
      "pane_id": "wB:p1",
      "terminal_id": "term_current_worker",
      "agent": "pi",
      "agent_session": {
        "source": "herdr:pi",
        "kind": "path",
        "value": "/current/worker-session.jsonl"
      },
      "task": "bounded owned task",
      "evidence": "/path/to/handoff.md"
    }
  ],
  "delivery": {
    "mode": "preview",
    "coalesce_ms": 250
  }
}
```

`owner` is singular. Names, panes, terminal IDs, sessions, tasks, and team size are data, not plugin constants. Terminal identity survives pane moves; a missing or mismatched terminal/session is rejected as stale, including for exit events.

Supported delivery adapters are currently `pi` and `codex`. Both have fixture-tested, conservative empty-composer checks. Unknown or occupied input is blocked. This is not a claim of live compatibility with every CLI.

## Preview and activation

Link a source checkout for development:

```bash
herdr plugin link ./dirigent-dispatch
herdr plugin action invoke preview --plugin com.chefgroep.dirigent-dispatch
```

`preview` validates every registered identity, inspects the director composer, and prints the pending compact message without submitting it.

Enable event collection only after preview succeeds:

```bash
herdr plugin action invoke start --plugin com.chefgroep.dirigent-dispatch
```

With `delivery.mode: "preview"`, events remain pending and no input is sent. To activate delivery, change the mode to `"live"`, rerun `preview`, then rerun `start` so the changed configuration and exact identities are registered.

The plugin listens to `pane.agent_status_changed` and `pane.exited`. `working` and `unknown` are tracked but do not notify. `idle`, `done`, `blocked`, and `exited` remain distinct. Duplicate consecutive states are dropped; distinct transitions arriving in one burst share one compact message. If that message reaches its size limit, omitted transitions remain pending for the next delivery.

## Delivery states

- `pending`: accepted worker transition, not submitted.
- `queued`: director is working; delivery waits for the director's next idle/done event or a manual resume.
- `blocked`: director identity, connection, status, or composer is unsafe.
- `submitting`: durable claim written before Herdr input.
- `submitted`: `herdr agent prompt` returned `agent_prompted`.
- `processed`: a later director `working` transition advanced beyond the submission sequence.
- task complete: never inferred by this plugin.

Director-owned events create no notification. A director `idle`/`done` event only flushes pending work; a later `working` transition can acknowledge processing. Busy directors are never interrupted automatically. Urgent steering remains an explicit human/dirigent action until a harness-specific interrupt contract is proven safe.

If the process or socket disconnects during submission, the claim becomes `ambiguous` after restart. It is not resent automatically. Inspect the director pane, then explicitly release it when safe:

```bash
herdr plugin action invoke retry-ambiguous --plugin com.chefgroep.dirigent-dispatch
```

## Pause, stop, rollback

```bash
herdr plugin action invoke pause --plugin com.chefgroep.dirigent-dispatch
herdr plugin action invoke resume --plugin com.chefgroep.dirigent-dispatch
herdr plugin action invoke stop --plugin com.chefgroep.dirigent-dispatch
herdr plugin action invoke status --plugin com.chefgroep.dirigent-dispatch
```

Pause preserves pending transitions and ignores new events. Resume verifies identities and retries pending work. Stop discards pending transitions and leaves an audit trail. Disable or roll back without deleting state:

```bash
herdr plugin disable com.chefgroep.dirigent-dispatch
# or, for a linked development checkout:
herdr plugin unlink com.chefgroep.dirigent-dispatch
```

State lives under `~/.local/state/herdr/plugins/com.chefgroep.dirigent-dispatch/`. Event hooks are short-lived processes; no watcher, daemon, cron, transcript mining, model selection, or provider configuration is introduced. The startup hook only reconciles durable pending state after Herdr restart and exits.

## Tests

```bash
npm test --prefix dirigent-dispatch
python3 scripts/validate.py
```

Fixtures cover irrelevant events, duplicate and burst transitions, stale identity, busy and idle directors, occupied input, disconnect/restart ambiguity, pause/stop, and Pi/Codex adapter boundaries. No live team is used by the tests.
