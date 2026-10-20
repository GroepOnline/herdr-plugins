import json
import tempfile
import unittest
from pathlib import Path
from scripts.check_upstream_compat import check_plugin

MANIFEST = '''
id = "example.valid"
name = "Valid"
version = "0.1.0"
min_herdr_version = "0.7.5"
platforms = ["linux"]
[[actions]]
id = "go"
contexts = ["global"]
command = ["node", "src/run.js"]
'''

class TestContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)
        (self.dir / "src").mkdir()
        (self.dir / "src/run.js").write_text("console.log(1)\n")
        (self.dir / "herdr-plugin.toml").write_text(MANIFEST)

    def test_valid(self):
        self.assertEqual([], check_plugin(self.dir))

    def test_missing_executable(self):
        (self.dir / "src/run.js").unlink()
        self.assertTrue(any("executable absent" in e for e in check_plugin(self.dir)))

    def test_missing_manifest(self):
        (self.dir / "herdr-plugin.toml").unlink()
        self.assertTrue(check_plugin(self.dir))

    def test_link_handler_requires_action(self):
        p = self.dir / "herdr-plugin.toml"
        p.write_text(MANIFEST + '''
[[link_handlers]]
id = "open"
title = "Open"
pattern = "https://example.com"
action = "unknown"
''')
        self.assertTrue(any("unresolved link action" in e for e in check_plugin(self.dir)))

    def test_generated_dist_requires_build(self):
        p = self.dir / "herdr-plugin.toml"
        p.write_text(MANIFEST.replace("src/run.js", "dist/run.js"))
        self.assertTrue(any("executable absent" in e for e in check_plugin(self.dir)))
        p.write_text(p.read_text() + '''
[[build]]
command = ["npm", "run", "build"]
''')
        (self.dir / "package.json").write_text(json.dumps({"scripts":{"build":"tsc"}}))
        self.assertEqual([], check_plugin(self.dir))

    def test_malformed_package_json(self):
        (self.dir / "package.json").write_text("{ invalid json }")
        errors = check_plugin(self.dir)
        self.assertTrue(any("invalid package.json" in e for e in errors))

    def test_invalid_semver(self):
        p = self.dir / "herdr-plugin.toml"
        p.write_text(MANIFEST.replace('version = "0.1.0"', 'version = "not-semver"'))
        errors = check_plugin(self.dir)
        self.assertTrue(any("invalid version" in e for e in errors))

    def test_missing_required_field(self):
        p = self.dir / "herdr-plugin.toml"
        p.write_text(MANIFEST.replace('id = "example.valid"\n', ''))
        errors = check_plugin(self.dir)
        self.assertTrue(any("missing id" in e for e in errors))

    def test_invalid_action_context(self):
        p = self.dir / "herdr-plugin.toml"
        p.write_text(MANIFEST.replace('contexts = ["global"]', 'contexts = ["invalid"]'))
        errors = check_plugin(self.dir)
        self.assertTrue(any("invalid action context" in e for e in errors))

    def test_invalid_event_no_dot(self):
        p = self.dir / "herdr-plugin.toml"
        p.write_text(MANIFEST + '''
[[events]]
on = "invalid_event"
command = ["node", "src/run.js"]
''')
        errors = check_plugin(self.dir)
        self.assertTrue(any("invalid event declaration" in e for e in errors))

    def test_duplicate_action_id(self):
        p = self.dir / "herdr-plugin.toml"
        p.write_text(MANIFEST + '''
[[actions]]
id = "go"
contexts = ["global"]
command = ["node", "src/run.js"]
''')
        errors = check_plugin(self.dir)
        self.assertTrue(any("duplicate actions id" in e for e in errors))

    def test_invalid_ident(self):
        p = self.dir / "herdr-plugin.toml"
        p.write_text(MANIFEST.replace('id = "go"', 'id = "go!"'))
        errors = check_plugin(self.dir)
        self.assertTrue(any("invalid actions id" in e for e in errors))

    def test_empty_platforms(self):
        p = self.dir / "herdr-plugin.toml"
        p.write_text(MANIFEST.replace('platforms = ["linux"]', 'platforms = []'))
        errors = check_plugin(self.dir)
        self.assertTrue(any("platforms missing" in e for e in errors))

    def test_missing_platforms(self):
        p = self.dir / "herdr-plugin.toml"
        lines = MANIFEST.strip().split('\n')
        lines = [l for l in lines if not l.startswith('platforms')]
        p.write_text('\n'.join(lines) + '\n')
        errors = check_plugin(self.dir)
        self.assertTrue(any("platforms missing" in e for e in errors))
