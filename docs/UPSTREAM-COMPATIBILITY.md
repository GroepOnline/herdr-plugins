# Upstream Herdr plugin compatibility

Ten ChefGroep plugin manifests were linked with Herdr 0.9.4-preview under an isolated XDG_CONFIG_HOME (all successful, no warnings). No plugin commands, startup hooks, or production APIs were invoked. The checker deliberately excludes UDO-related integrations and validates only declared plugin-v1 contracts and local entrypoint paths.

Run: python3 scripts/check_upstream_compat.py
Run tests: python3 -m unittest discover -s tests -p 'test_upstream_contract.py'

The core Herdr fork remains separate. The upstream plugin-v1 API supports manifest-declared actions, events, startup hooks, panes, and link handlers; native non-terminal UI cannot be migrated to a plugin without upstream core support. Functional action/remote API smoke tests remain separate from these static checks.
