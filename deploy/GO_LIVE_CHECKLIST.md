# Go-Live Checklist (Oracle Cloud)

## A) Pre-Migration (T-24h to T-1h)

1. Freeze deployment window and notify stakeholders.
2. Confirm latest commit passed CI workflow checks.
3. Verify secrets are configured in `apps/api/.env` from the template.
4. Confirm CloudPanel site is configured to proxy traffic to `http://127.0.0.1:8080` (or your configured `APP_HTTP_PORT`).
5. PocketBase runtime binary:
   - No manual binary permission step is needed.
   - Docker Compose downloads the correct Linux PocketBase binary automatically based on CPU architecture.
6. Backup PocketBase data directory and keep timestamped copy.
7. Confirm required DNS records point to Oracle VM public IP.
8. Confirm ports 80 and 443 are open for CloudPanel nginx in OCI Security List/NSG.
9. Confirm Docker stack does not bind public `80/443` (only localhost high port).

## B) Migration Window (T0)

1. Pull latest code on server.
2. Apply PocketBase migrations (including AI image jobs migration).
3. Build and start production stack:
   - `docker compose -f docker-compose.prod.yml up -d --build`
4. Wait until all services report healthy startup logs.
5. Confirm container status:
   - `docker compose -f docker-compose.prod.yml ps`
   - `pocketbase`, `api`, `web`, `nginx` must be `Up`.
6. Confirm no restart loops:
   - `for s in pocketbase api web nginx; do cid=$(docker compose -f docker-compose.prod.yml ps -q "$s"); echo "$s $(docker inspect -f '{{.RestartCount}}' "$cid")"; done`
7. Check API health endpoint:
   - `https://YOUR_DOMAIN/api/health`
8. Confirm health payload includes:
   - `services.database.status = up`
   - `services.queue.active = true`
   - `services.imageQueue.active = true`

## C) Functional Validation (T+10m)

1. Login with a production test account.
2. Open Settings page and save OpenAI API key.
3. In AI Pins page, run both image modes:
   - Use Featured Image
   - Generate AI Image
4. Confirm preview appears before saving.
5. Confirm regenerate action works for generated image.
6. Confirm download action works for generated image.
7. Confirm compare view shows generated image and featured image.
8. Save generated pins and verify records created.
9. Trigger publish/schedule for a test pin and verify queue progression.

## D) Post-Migration Monitoring (T+30m to T+24h)

1. Monitor API logs for error spikes.
2. Monitor queue metrics in `/api/health` for failed totals.
3. Monitor Pinterest publish events for failures/retries.
4. Re-run health smoke script every 30 minutes in first 2 hours.
5. Validate no authentication regression in protected routes.

## E) Rollback Criteria

Rollback immediately if any of the following occurs:
1. `/api/health` remains degraded for more than 10 minutes.
2. AI image generation fails with no fallback images for test pins.
3. Queue workers are inactive after restart attempts.
4. Pinterest publishing path is blocked for all users.

## F) Rollback Procedure

1. Stop current deployment:
   - `docker compose -f docker-compose.prod.yml down`
2. Restore previous known good image tags or previous commit release.
3. Restart stack with previous version.
4. Confirm `/api/health` returns stable `ok`.
5. Validate queue recovery and basic publish flow.

## G) Sign-Off

Release is accepted only after:
1. Health endpoint stable for 2 hours.
2. AI image generation + fallback behavior validated.
3. At least one successful end-to-end publish confirmed.
4. No critical errors in API logs.
