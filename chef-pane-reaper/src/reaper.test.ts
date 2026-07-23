import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isLiveMode, runReaper, reaperPath, writeFragment, getStateDir } from "./common";

describe("isLiveMode", () => {
  it("treats unset as dry-run", () => assert.equal(isLiveMode(undefined), false));
  it("treats empty as dry-run", () => assert.equal(isLiveMode(""), false));
  it("treats invalid values as dry-run", () => {
    assert.equal(isLiveMode("true"), false);
    assert.equal(isLiveMode("yes"), false);
    assert.equal(isLiveMode("0"), false);
  });
  it('treats "1" as live mode', () => assert.equal(isLiveMode("1"), true));
});

describe("runReaper", () => {
  let scriptPath = "";
  const prevScript = process.env.GHOST_REAPER_SCRIPT;
  const prevStateDir = process.env.HERDR_PLUGIN_STATE_DIR;

  before(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reaper-test-"));
    scriptPath = path.join(dir, "fake-reaper.sh");
    fs.writeFileSync(
      scriptPath,
      `#!/usr/bin/env bash
if [[ "$1" == "--dry-run" ]]; then
  echo "dry-run-ok"
  exit 0
fi
echo "live-ok"
exit 0
`,
      { mode: 0o755 },
    );
    process.env.GHOST_REAPER_SCRIPT = scriptPath;
    process.env.HERDR_PLUGIN_STATE_DIR = path.join(dir, "state");
  });

  after(() => {
    if (prevScript === undefined) delete process.env.GHOST_REAPER_SCRIPT;
    else process.env.GHOST_REAPER_SCRIPT = prevScript;
    if (prevStateDir === undefined) delete process.env.HERDR_PLUGIN_STATE_DIR;
    else process.env.HERDR_PLUGIN_STATE_DIR = prevStateDir;
  });

  it("passes --dry-run in dry-run mode", () => {
    const result = runReaper(true);
    assert.equal(result.ok, true);
    assert.match(result.output, /dry-run-ok/);
    assert.equal(result.exitCode, 0);
  });

  it("runs live without --dry-run", () => {
    const result = runReaper(false);
    assert.equal(result.ok, true);
    assert.match(result.output, /live-ok/);
  });

  it("reports non-zero exit codes", () => {
    const failScript = scriptPath.replace("fake-reaper.sh", "fail-reaper.sh");
    fs.writeFileSync(failScript, "#!/usr/bin/env bash\nexit 2\n", { mode: 0o755 });
    process.env.GHOST_REAPER_SCRIPT = failScript;
    const result = runReaper(true);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 2);
    process.env.GHOST_REAPER_SCRIPT = scriptPath;
  });

  it("writes fragment output to private state dir", () => {
    writeFragment({ ok: true, dry_run: true }, "test display");
    const fragmentPath = path.join(process.env.HERDR_PLUGIN_STATE_DIR || getStateDir(), "pane-reaper.json");
    assert.ok(fs.existsSync(fragmentPath));
    const fragment = JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
    assert.equal(fragment.component, "pane-reaper");
    assert.equal(fragment.display, "test display");
  });
});

describe("reaperPath", () => {
  const prev = process.env.GHOST_REAPER_SCRIPT;

  after(() => {
    if (prev === undefined) delete process.env.GHOST_REAPER_SCRIPT;
    else process.env.GHOST_REAPER_SCRIPT = prev;
  });

  it("expands leading ~/", () => {
    process.env.GHOST_REAPER_SCRIPT = "~/scripts/reaper.sh";
    assert.equal(reaperPath(), path.join(process.env.HOME || os.homedir(), "scripts/reaper.sh"));
  });
});
