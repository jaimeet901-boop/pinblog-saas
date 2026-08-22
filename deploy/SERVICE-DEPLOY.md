# Service-scoped production deploys (Phase 3) + rollback (Phase 4)

Routine Web or API changes must **not** recreate PocketBase, the peer app service, Docker nginx, or host nginx.

## Preferred deploy commands

```bash
CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-web.sh
CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-api.sh

DRY_RUN=1 ALLOW_DIRTY_WORKTREE=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-web.sh
```

## Preferred rollback commands

```bash
# Uses PREVIOUS_IMAGE_ID, else state file, else seodeva-{web|api}:previous
CONFIRM_PRODUCTION=YES ./deploy/scripts/rollback-web.sh
CONFIRM_PRODUCTION=YES ./deploy/scripts/rollback-api.sh

PREVIOUS_IMAGE_ID=sha256:… CONFIRM_PRODUCTION=YES ./deploy/scripts/rollback-web.sh
DRY_RUN=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/rollback-web.sh
```

Rollback works with a **dirty** Git worktree (no build / no git required).

### Rollback source priority (immutable)

1. Explicit `PREVIOUS_IMAGE_ID` (Docker image ID `sha256:…`)
2. `deploy/state/last-web-deploy.json` or `last-api-deploy.json` → `previous_image_id`
3. Retention tag `seodeva-web:previous` / `seodeva-api:previous`

**Never** use `pinblog-saas-web:latest` or `pinblog-saas-api:latest` as the rollback source.

### What deploy does

1. Production confirmation (`CONFIRM_PRODUCTION=YES` or interactive `PRODUCTION`)
2. Refuse dirty tree unless `ALLOW_DIRTY_WORKTREE=1`
3. Snapshot peers + target; write **pending** state (previous image ID)
4. Tag `seodeva-{service}:previous` → exact previous image ID (**before** moving Compose tags)
5. Build `seodeva-{service}:<GIT_SHA>` (Phase 2)
6. Retag onto Compose project image; `up -d --no-deps --force-recreate <service>`
7. Health + HTTP + peer isolation
8. On **success**: write `status=success` state (still retains `previous_image_id`)
9. On **failure** (default): write `status=failed`, print rollback command, exit non-zero — **no auto-rollback**
10. On **failure** with `AUTO_ROLLBACK=1`: rollback using only the recorded previous image ID (no build, no git, no `compose down`)

### AUTO_ROLLBACK

Opt-in only:

```bash
AUTO_ROLLBACK=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-web.sh
```

If auto-rollback itself fails, scripts print that **manual intervention** is required.

### State files

| File | Purpose |
|------|---------|
| `deploy/state/last-web-deploy.json` | Last web deploy/rollback metadata |
| `deploy/state/last-api-deploy.json` | Last api deploy/rollback metadata |

- Gitignored (see `.gitignore`); directory kept via `deploy/state/.gitkeep`
- **No secrets**
- Written atomically (`*.tmp.$$` → `mv`)

### Health verification

- Compose healthchecks (web `/`, api `/api/health` on 3001)
- After healthy: `http://127.0.0.1:${APP_HTTP_PORT}/` (web) or `…/api/health` (api)

### Isolation

| Deploy / rollback | Must stay unchanged |
|-------------------|---------------------|
| Web | API, PocketBase, Docker nginx, host nginx |
| API | Web, PocketBase, Docker nginx, host nginx |

### Image retention

Do **not** `docker image prune` retained rollback images (`seodeva-*:previous`, recorded `sha256:…` IDs) without a replacement recovery plan.

### NOT for routine isolated changes

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### UNSAFE for routine service rollback

`deploy/scripts/oracle-rollback.sh` runs `compose down` + `up -d --build` (rebuilds **current** tree / full stack). Keep for rare emergency full-stack procedures only — **not** for Web/API digest rollback.

## Environment variables

| Variable | Meaning |
|----------|---------|
| `CONFIRM_PRODUCTION=YES` | Skip interactive prompt |
| `ALLOW_DIRTY_WORKTREE=1` | Allow dirty tree on **deploy** (warns) |
| `AUTO_ROLLBACK=1` | Opt-in auto rollback after failed deploy |
| `PREVIOUS_IMAGE_ID` | Explicit rollback image ID |
| `DRY_RUN=1` | Print actions; no mutation |
| `COMPOSE_FILE` | Default `docker-compose.prod.yml` |
| `APP_HTTP_PORT` | Default `18080` |
| `HEALTH_WAIT_SECONDS` | Default `180` |
| `DEPLOY_STATE_DIR` | Default `deploy/state` |
