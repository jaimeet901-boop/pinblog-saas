# Facebook Channel Pack — Operations

**Scope:** Runtime tuning for Facebook read paths and the F7-4 insights sync worker.  
**Baseline:** F8-3 hardening polish.

---

## Insights sync worker (F7-4)

The worker polls published `facebook_publish_jobs` records and refreshes Graph Insights into each job's `performance` blob. It is registered in `apps/api/src/main.js` alongside the Pinterest analytics sync worker.

| Variable | Default | Description |
|----------|---------|-------------|
| `FACEBOOK_ANALYTICS_ENABLED` | enabled | Set to `0` or `false` to disable the worker. Unset or `1`/`true` keeps it running. |
| `FACEBOOK_ANALYTICS_POLL_MS` | `900000` (15 min) | Poll interval between sync ticks. |
| `FACEBOOK_ANALYTICS_BATCH` | `20` | Maximum jobs processed per tick. |
| `FACEBOOK_ANALYTICS_RESYNC_MS` | `21600000` (6 h) | Minimum age before a previously synced job is eligible for refresh. |

Worker implementation: `apps/api/src/services/facebook/facebook-analytics-sync.js`.

---

## Read-path APIs (F7-3 / F7-6)

| Endpoint | Service | Notes |
|----------|---------|-------|
| `GET /facebook/history` | `history.js` → unified `listPublishingHistory` | Facebook-only channel filter |
| `GET /facebook/analytics` | `analytics.js` → `facebook_publish_jobs` rollup | Read-only; uses F7-4 synced `performance` |

Both paths short-circuit to empty responses when the request has no workspace owner/creator scope (F8-3).

Hub UI loads analytics from `/facebook/analytics` when the Analytics tab is available (`FacebookPage.jsx`).

---

## PocketBase dependency

The sync worker and read-path services require a configured PocketBase superuser (`PB_SUPERUSER_EMAIL`) in production. Without it, the worker logs to stdout and read-path I/O may be unavailable in test environments.
