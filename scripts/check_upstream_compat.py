#!/usr/bin/env python3
"""Offline upstream Herdr plugin-v1 contract gate. Never runs plugin commands."""
from __future__ import annotations
import json
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# UDO-related plugins are explicitly excluded.
PLUGINS = ("chatgpt-bridge", "chef-github-status", "chef-linear-context",
           "chef-pane-reaper", "cloudflare-tunnel", "dirigent-dispatch",
           "fleet-health", "issue-provision", "ops", "session-park")
SEMVER = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$")
IDENT = re.compile(r"^[A-Za-z0-9:_-]+$")


def check_plugin(folder: Path) -> list[str]:
    """Validate a single plugin manifest and entrypoints.

    Args:
        folder: Path to the plugin directory containing herdr-plugin.toml.

    Returns:
        List of error strings; empty if the plugin passes all checks.
    """
    errors: list[str] = []
    try:
        m = tomllib.loads((folder / "herdr-plugin.toml").read_text())
    except (OSError, ValueError) as exc:
        return [f"{folder.name}: cannot parse manifest: {exc}"]
    for k in ("id", "name", "version", "min_herdr_version"):
        if not isinstance(m.get(k), str) or not m[k]:
            errors.append(f"{folder.name}: missing {k}")
    for k in ("version", "min_herdr_version"):
        if not isinstance(m.get(k), str) or not SEMVER.fullmatch(m[k]):
            errors.append(f"{folder.name}: invalid {k}")
    if not isinstance(m.get("platforms"), list) or not m["platforms"]:
        errors.append(f"{folder.name}: platforms missing")
    steps = m.get("build", [])
    builds = any(s.get("command") == ["npm", "run", "build"] for s in steps)
    pkg_path = folder / "package.json"
    pkg: dict = {}
    if pkg_path.is_file():
        try:
            pkg = json.loads(pkg_path.read_text())
        except json.JSONDecodeError as exc:
            errors.append(f"{folder.name}: invalid package.json: {exc}")
    generates_dist = builds and bool(pkg.get("scripts", {}).get("build"))
    ids: dict[str, set[str]] = {}
    for section in ("actions", "events", "panes", "startup", "build", "link_handlers"):
        for entry in m.get(section, []):
            if section in ("actions", "panes", "link_handlers"):
                ident = entry.get("id", "")
                if not IDENT.fullmatch(ident):
                    errors.append(f"{folder.name}: invalid {section} id {ident!r}")
                elif ident in ids.setdefault(section, set()):
                    errors.append(f"{folder.name}: duplicate {section} id {ident}")
                else:
                    ids[section].add(ident)
            if section == "link_handlers":
                continue
            cmd = entry.get("command", [])
            if not isinstance(cmd, list) or not cmd or not all(isinstance(v, str) and v for v in cmd):
                errors.append(f"{folder.name}: invalid {section} command")
                continue
            candidates = []
            if cmd[0].startswith("./"):
                candidates.append(cmd[0])
            if len(cmd) > 1 and cmd[0] in ("node", "sh", "bash", "python3"):
                if cmd[1].startswith(("src/", "dist/", "scripts/", "./")):
                    candidates.append(cmd[1])
            for rel in candidates:
                if not (folder / rel).is_file() and not (rel.startswith("dist/") and generates_dist):
                    errors.append(f"{folder.name}: executable absent: {rel}")
            if section == "events" and "." not in entry.get("on", ""):
                errors.append(f"{folder.name}: invalid event declaration")
            if section == "actions" and any(
                c not in ("global", "pane", "workspace") for c in entry.get("contexts", [])
            ):
                errors.append(f"{folder.name}: invalid action context")
    for handler in m.get("link_handlers", []):
        if handler.get("action") not in ids.get("actions", set()):
            errors.append(f"{folder.name}: unresolved link action {handler.get('action')}")
    return errors


def main() -> int:
    """Run the upstream compatibility check for all configured plugins.

    Returns:
        0 if all plugins pass, 1 if any validation errors found.
    """
    errors = [e for name in PLUGINS for e in check_plugin(ROOT / name)]
    for e in errors:
        print("FAIL", e)
    if errors:
        return 1
    print(f"PASS: {len(PLUGINS)} upstream Herdr plugin-v1 contracts, offline")
    return 0


if __name__ == "__main__":
    sys.exit(main())
