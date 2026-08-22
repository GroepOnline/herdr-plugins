# com.chefgroep.linear-context

Linear issue-context in de Herdr Fleet Ops Bar.

**SSOT:** de Linear API voor titel, status en assignee van het issue dat bij de workspace hoort.

## Actions

| Action | Wat |
|---|---|
| `fetch-issue [ID]` | Haalt titel/status/assignee op voor het gekoppelde Linear-issue (id uit arg, `HERDR_LINEAR_ISSUE_ID`, of aangeklikte issue-URL) |
| `set-issue <ID>` | Koppelt een Linear-issue aan de workspace-context |

## Build

Het manifest installeert en bouwt zelf (`npm install`, `npm run build`); runtime is `node dist/*.js`.

## Config

| Env | Default | Betekenis |
|---|---|---|
| `HERDR_LINEAR_ISSUE_ID` | – | issue-id zoals `GRO-123` |
| `HERDR_PLUGIN_CLICKED_URL` | – | Linear-URL uit een link_handler-click |

## Vereisten

- Linear API-toegang via de omgeving waarin Herdr draait
- Node 20+
