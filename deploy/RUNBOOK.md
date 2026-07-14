# Production Runbook

## Scope
This runbook covers operational monitoring, incident response, and rollback for the Pinterest Automation SaaS production stack.

## Services
- web (Vite static app behind Nginx)
- api (Express API)
- pocketbase (database/auth)
- queue worker (in-process in api)

## Health Endpoints
- Public: https://YOUR_DOMAIN/api/health
- Expected response fields:
  - status
  - services.database.status
  - services.redis.status
  - services.queue.active

## Daily Checks
1. Open health endpoint and confirm status is ok.
2. Confirm queue is active and lastRunAt updates.
3. Confirm failedTotal does not grow unexpectedly.
4. Confirm Pinterest publish jobs are progressing in dashboard.

## Incident Severity
- Sev1: API down, health endpoint unavailable, publishing completely blocked.
- Sev2: Queue active but repeated failures, degraded publishing throughput.
- Sev3: Minor UI issue with workaround available.

## Immediate Incident Actions
1. Capture current health payload.
2. Check container/process status.
3. Check latest API logs for auth/publish failures.
4. If queue stalled, restart api service.
5. If deployment introduced the issue, rollback.

## Docker Commands
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=200 api
docker compose -f docker-compose.prod.yml restart api
```

## PM2 Commands
```bash
pm2 status
pm2 logs horizons-api --lines 200
pm2 restart horizons-api
```

## Rollback Procedure
1. Pull previous known good image tags (or revert commit and rebuild).
2. Deploy previous stack version.
3. Verify /api/health status.
4. Verify publish queue resumes and pending jobs recover.

## Data Safety
- Do not delete PocketBase volumes during rollback.
- Keep encrypted token fields untouched.
- Always backup PocketBase data directory before migration changes.

## Post-Incident
1. Document root cause and timeline.
2. Add prevention action (alert/check/test).
3. Update this runbook if procedure changed.
