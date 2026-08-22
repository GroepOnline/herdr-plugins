# com.chefgroep.github-status

GitHub PR/CI-status in de Herdr Fleet Ops Bar.

**SSOT:** de GitHub API (via `gh` CLI-auth van de omgeving) voor de repo van de actieve workspace.

## Actions

| Action | Wat |
|---|---|
| `check-pr` | Mergeable state, reviews en CI-checks voor de branch van de huidige workspace |
| `list-prs` | Alle open PR's van de workspace-repo |

Plus een `github-pr-url` link_handler ("Check This PR") die `check-pr` draait op een aangeklikte PR-URL, en een `workspace.focused`-event dat status ververst.

## Build

Het manifest installeert en bouwt zelf (`npm install`, `npm run build`) voordat actions draaien; runtime is `node dist/*.js`.

## Vereisten

- `gh` CLI of `GH_TOKEN` met leesrechten op de repo
- Node 20+
