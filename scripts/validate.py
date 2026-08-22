#!/usr/bin/env python3
"""Plugin PR gate: manifest, package.json and registry.json consistency.

Run from repo root: python3 scripts/validate.py
Exits non-zero on the first category of failures it reports.
"""
from __future__ import annotations

import json
import sys
import tomllib
from pathlib import Path

REQUIRED_KEYS = ("id", "name", "version", "min_herdr_version")
errors: list[str] = []
warnings: list[str] = []

root = Path(__file__).resolve().parent.parent


def plugin_dirs() -> list[Path]:
    return sorted(
        p.parent for p in root.glob("*/herdr-plugin.toml") if ".git" not in p.parts
    )


def main() -> int:
    manifests: dict[str, dict] = {}

    for d in plugin_dirs():
        mpath = d / "herdr-plugin.toml"
        try:
            m = tomllib.loads(mpath.read_text())
        except Exception as exc:  # noqa: BLE001 - report and continue
            errors.append(f"{d.name}: unparsable manifest: {exc}")
            continue
        missing = [k for k in REQUIRED_KEYS if not m.get(k)]
        if missing:
            errors.append(f"{d.name}: manifest missing {missing}")
            continue
        pid = m["id"]
        if pid in manifests:
            errors.append(f"{d.name}: duplicate plugin id {pid} (also in {manifests[pid]['_dir']})")
        manifests[pid] = {**m, "_dir": d.name}
        actions = [a.get("id") for a in m.get("actions", [])]
        if len(actions) != len(set(actions)):
            errors.append(f"{d.name}: duplicate action ids")

    # registry consistency: every local plugin present with same id/name/version;
    # entries without a local dir are allowed only when they point elsewhere.
    reg_path = root / "registry.json"
    try:
        registry = json.loads(reg_path.read_text())
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL registry.json: {exc}")
        return 1
    entries = {e.get("id"): e for e in registry.get("plugins", [])}

    for pid, m in sorted(manifests.items()):
        entry = entries.get(pid)
        if entry is None:
            errors.append(f"registry.json: no entry for {pid} ({m['_dir']})")
            continue
        for key in ("name", "version"):
            if entry.get(key) != m[key]:
                errors.append(
                    f"registry.json: {pid} {key}={entry.get(key)!r} != manifest {m[key]!r}"
                )

    for pid, entry in sorted(entries.items()):
        if pid not in manifests and "herdr-plugins/tree/main" in str(entry.get("homepage", "")):
            errors.append(f"registry.json: {pid} points into this repo but has no plugin dir")

    # package.json version drift inside each plugin dir
    for pid, m in manifests.items():
        pkg_path = root / m["_dir"] / "package.json"
        if not pkg_path.exists():
            continue
        try:
            pkg = json.loads(pkg_path.read_text())
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{m['_dir']}: unparsable package.json: {exc}")
            continue
        if pkg.get("version") != m["version"]:
            errors.append(
                f"{m['_dir']}: package.json version {pkg.get('version')!r} != manifest {m['version']!r}"
            )

    for line in warnings:
        print(f"WARN {line}")
    if errors:
        for line in errors:
            print(f"FAIL {line}")
        return 1
    print(f"OK {len(manifests)} plugins validated against registry.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
