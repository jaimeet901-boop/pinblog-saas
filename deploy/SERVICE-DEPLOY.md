# Service-scoped production deploys (Phase 3)

Routine Web or API changes must **not** recreate PocketBase, the peer app service, Docker nginx, or host nginx.

## Preferred commands

From the repository root on the production host:

```bash
# Web only
CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-web.sh

# API only
CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-api.sh
```

Dry-run (prints planned actions; does **not** build/recreate if `DRY_RUN=1` short-circuits mutate steps):

```bash
DRY_RUN=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-web.sh
DRY_RUN=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-api.sh
```

### What these scripts do

1. Require production confirmation (`CONFIRM_PRODUCTION=YES` or interactive `PRODUCTION`)
2. Refuse a dirty Git worktree unless `ALLOW_DIRTY_WORKTREE=1`
3. Record the exact `git rev-parse HEAD` SHA
4. Snapshot container ID + image ID for **web, api, pocketbase, nginx**
5. Build `seodeva-<service>:<GIT_SHA>` via `deploy/scripts/build-images-with-sha.sh` (Phase 2 OCI labels)
6. Retag that image onto the Compose project image (`pinblog-saas-web` / `pinblog-saas-api`)
7. Recreate **only** the target service:

```bash
docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate web
# or
docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate api
```

8. Wait for Compose healthchecks
9. Assert peer services’ container ID + image ID are unchanged
10. HTTP check via Docker nginx localhost bind (`APP_HTTP_PORT`, default `18080`)
11. Print previous/new image IDs (preserved for Phase 4 rollback) + SHA digest/OCI revision

### What must remain unchanged

| Deploy | Must stay unchanged |
|--------|---------------------|
| Web | API, PocketBase, Docker nginx, **host nginx** |
| API | Web, PocketBase, Docker nginx, **host nginx** |

Isolation is enforced by comparing pre/post snapshots. Host nginx is never invoked.

## Dirty worktree protection

Default: **refuse** if `git status --porcelain` is non-empty.

Override (explicit only):

```bash
ALLOW_DIRTY_WORKTREE=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-web.sh
```

The override prints the dirty status and the Git SHA still used for tags/labels. Scripts never auto-commit or push.

## Health verification

Uses existing Compose healthchecks:

- **Web** container: `wget` `http://127.0.0.1/` (inside container)
- **API** container: `GET http://127.0.0.1:3001/api/health` (inside container)

After healthy:

- Web deploy: `curl http://127.0.0.1:${APP_HTTP_PORT}/`
- API deploy: `curl http://127.0.0.1:${APP_HTTP_PORT}/api/health`

## Image SHA / digest inspection

```bash
docker inspect "<container>" \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'

docker image inspect "seodeva-web:<GIT_SHA>" --format '{{.Id}}'
```

See also `deploy/IMAGE-VERSIONING.md`.

## NOT the routine method for isolated changes

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This rebuilds/recreates the stack dependency path and can restart API/Web/nginx together. Keep it for **initial provisioning** or rare full-stack go-live (`deploy/scripts/oracle-go-live.sh`), not for day-to-day Web-only or API-only updates.

## Environment variables

| Variable | Meaning |
|----------|---------|
| `CONFIRM_PRODUCTION=YES` | Skip interactive prompt |
| `ALLOW_DIRTY_WORKTREE=1` | Allow dirty tree (warns) |
| `DRY_RUN=1` | Skip build/retag/up/health waits/HTTP |
| `COMPOSE_FILE` | Default `docker-compose.prod.yml` |
| `APP_HTTP_PORT` | Default `18080` |
| `HEALTH_WAIT_SECONDS` | Default `180` |
| `VITE_PADDLE_CLIENT_TOKEN` | Passed through to Web image build if set |

## Phase 4 note

Scripts print the **previous** image ID. Digest-based rollback (retag old ID → project tag + `--no-deps --force-recreate`) is deferred to Phase 4 — these scripts only preserve/report the reference.
