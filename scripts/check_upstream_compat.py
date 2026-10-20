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
SECTIONS = ("actions", "events", "panes", "startup", "build", "link_handlers")
IDENTIFIED_SECTIONS = ("actions", "panes", "link_handlers")


def _read_manifest(folder: Path) -> tuple[dict, list[str]]:
    try:
        return tomllib.loads((folder / "herdr-plugin.toml").read_text()), []
    except (OSError, ValueError) as exc:
        return {}, [f"{folder.name}: cannot parse manifest: {exc}"]


def _header_errors(folder: Path, manifest: dict) -> list[str]:
    errors = []
    for key in ("id", "name", "version", "min_herdr_version"):
        if not isinstance(manifest.get(key), str) or not manifest[key]:
            errors.append(f"{folder.name}: missing {key}")
    for key in ("version", "min_herdr_version"):
        val = manifest.get(key)
        if not isinstance(val, str) or not SEMVER.fullmatch(val):
            errors.append(f"{folder.name}: invalid {key}")
    if not isinstance(manifest.get("platforms"), list) or not manifest["platforms"]:
        errors.append(f"{folder.name}: platforms missing")
    return errors


def _generated_dist(folder: Path, manifest: dict) -> tuple[bool, list[str]]:
    package_path = folder / "package.json"
    if not package_path.is_file():
        return False, []
    try:
        package = json.loads(package_path.read_text())
    except (OSError, ValueError) as exc:
        return False, [f"{folder.name}: invalid package.json: {exc}"]
    has_build = any(
        entry.get("command") == ["npm", "run", "build"]
        for entry in manifest.get("build", [])
    )
    return has_build and bool(package.get("scripts", {}).get("build")), []


def _id_errors(folder: Path, section: str, entry: dict, seen: set[str]) -> list[str]:
    identifier = entry.get("id", "")
    if not isinstance(identifier, str) or not IDENT.fullmatch(identifier):
        return [f"{folder.name}: invalid {section} id {identifier!r}"]
    if identifier in seen:
        return [f"{folder.name}: duplicate {section} id {identifier}"]
    seen.add(identifier)
    return []


def _command_paths(command: list[str]) -> list[str]:
    paths = [command[0]] if command[0].startswith("./") else []
    if len(command) > 1 and command[0] in ("node", "sh", "bash", "python3"):
        if command[1].startswith(("src/", "dist/", "scripts/", "./")):
            paths.append(command[1])
    return paths


def _command_errors(folder: Path, section: str, command: object,
                    generated_dist: bool) -> list[str]:
    if not isinstance(command, list) or not command:
        return [f"{folder.name}: invalid {section} command"]
    if not all(isinstance(arg, str) and arg for arg in command):
        return [f"{folder.name}: invalid {section} command"]
    return [
        f"{folder.name}: executable absent: {path}"
        for path in _command_paths(command)
        if not (folder / path).is_file()
        and not (path.startswith("dist/") and generated_dist)
    ]


def _entry_errors(folder: Path, section: str, entry: dict,
                  seen: set[str], generated_dist: bool) -> list[str]:
    errors = _id_errors(folder, section, entry, seen) if section in IDENTIFIED_SECTIONS else []
    if section == "link_handlers":
        return errors
    errors.extend(_command_errors(folder, section, entry.get("command"), generated_dist))
    if section == "events" and "." not in entry.get("on", ""):
        errors.append(f"{folder.name}: invalid event declaration")
    if section == "actions" and any(
        context not in ("global", "pane", "workspace")
        for context in entry.get("contexts", [])
    ):
        errors.append(f"{folder.name}: invalid action context")
    return errors


def _section_errors(folder: Path, manifest: dict, generated_dist: bool) -> list[str]:
    errors: list[str] = []
    for section in SECTIONS:
        seen: set[str] = set()
        for entry in manifest.get(section, []):
            errors.extend(_entry_errors(folder, section, entry, seen, generated_dist))
    return errors


def _link_errors(folder: Path, manifest: dict) -> list[str]:
    actions = {entry.get("id") for entry in manifest.get("actions", [])}
    return [
        f"{folder.name}: unresolved link action {handler.get('action')}"
        for handler in manifest.get("link_handlers", [])
        if handler.get("action") not in actions
    ]


def check_plugin(folder: Path) -> list[str]:
    manifest, errors = _read_manifest(folder)
    if errors:
        return errors
    generated, build_errors = _generated_dist(folder, manifest)
    errors = _header_errors(folder, manifest) + build_errors
    errors.extend(_section_errors(folder, manifest, generated))
    errors.extend(_link_errors(folder, manifest))
    return errors


def main() -> int:
    errors = [error for name in PLUGINS for error in check_plugin(ROOT / name)]
    for error in errors:
        print("FAIL", error)
    if errors:
        return 1
    print(f"PASS: {len(PLUGINS)} upstream Herdr plugin-v1 contracts, offline")
    return 0


if __name__ == "__main__":
    sys.exit(main())
