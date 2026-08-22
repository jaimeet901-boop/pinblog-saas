# Image version traceability (Phase 2)

Goal: every Seodeva **API** and **Web** Docker image can be traced to the exact Git commit that produced it.

This does **not** deploy, push to a registry, or change running production containers. It documents how to **build** and **inspect** versioned images locally / on the server.

## Tags

| Tag | Purpose |
|-----|---------|
| `seodeva-api:<GIT_SHA>` / `seodeva-web:<GIT_SHA>` | **Immutable** — preferred for “what commit is this image?” |
| `seodeva-api:latest` / `seodeva-web:latest` | Optional local alias (mutable). Keep only if you still want a convenient name. |
| Compose project tags (e.g. `pinblog-saas-api:latest`) | Existing Compose naming. Unchanged by this Phase. Prefer SHA tags when building for auditability. |

`<GIT_SHA>` must be the full `git rev-parse HEAD` (or the CI `github.sha`) of the tree that was built.

## OCI labels (baked into the image)

Set via Docker build-args (never secrets):

| Label | Source |
|-------|--------|
| `org.opencontainers.image.revision` | `GIT_SHA` |
| `org.opencontainers.image.created` | `BUILD_DATE` (UTC ISO-8601) |
| `org.opencontainers.image.source` | GitHub repo URL |
| `org.opencontainers.image.title` | `seodeva-api` or `seodeva-web` |
| `com.seodeva.component` | `api` or `web` |

## Safe local build (recommended)

From the repository root:

```bash
./deploy/scripts/build-images-with-sha.sh
# optional mutable alias:
./deploy/scripts/build-images-with-sha.sh --also-latest
# one service:
./deploy/scripts/build-images-with-sha.sh api
./deploy/scripts/build-images-with-sha.sh web
```

Equivalent manual commands:

```bash
GIT_SHA="$(git rev-parse HEAD)"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

docker build \
  --build-arg GIT_SHA="${GIT_SHA}" \
  --build-arg BUILD_DATE="${BUILD_DATE}" \
  -t "seodeva-api:${GIT_SHA}" \
  -t seodeva-api:latest \
  -f Dockerfile.api \
  .

docker build \
  --build-arg GIT_SHA="${GIT_SHA}" \
  --build-arg BUILD_DATE="${BUILD_DATE}" \
  --build-arg VITE_PADDLE_CLIENT_TOKEN="${VITE_PADDLE_CLIENT_TOKEN:-}" \
  -t "seodeva-web:${GIT_SHA}" \
  -t seodeva-web:latest \
  -f Dockerfile.web \
  .
```

Do **not** run `docker compose up` / rebuild production as part of this procedure unless you have a separate, approved deploy change.

## Identify a running container’s version

Replace `<container>` with the container name or ID (`docker ps`).

```bash
# Git commit SHA (OCI revision)
docker inspect "<container>" \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'

# Build timestamp
docker inspect "<container>" \
  --format '{{ index .Config.Labels "org.opencontainers.image.created" }}'

# Component
docker inspect "<container>" \
  --format '{{ index .Config.Labels "com.seodeva.component" }}'

# Image name:tag as configured on the container
docker inspect "<container>" --format '{{ .Config.Image }}'

# Image ID
docker inspect "<container>" --format '{{ .Image }}'

# Repo digests (only if the image was pulled from a registry; often empty for local builds)
docker inspect "<container>" --format '{{ range .RepoDigests }}{{ println . }}{{ end }}'
```

From an **image** tag (not a running container):

```bash
docker image inspect "seodeva-web:<GIT_SHA>" \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

## CI

`production-readiness.yml` → job `docker-build-smoke`:

- Builds with `GIT_SHA=${{ github.sha }}` and a UTC `BUILD_DATE`
- Tags `seodeva-api|web:${{ github.sha }}` and `:ci-smoke`
- Asserts `org.opencontainers.image.revision` equals `github.sha`
- Does **not** push images or deploy

## Compatibility notes

- Images built **without** `GIT_SHA` / `BUILD_DATE` still build; labels default to `unknown`.
- Existing Compose production workflow (`pinblog-saas-*:latest`) is unchanged until operators deliberately build with these args/tags.
- Older running containers will have **no** revision label until they are rebuilt from this Phase’s Dockerfiles (separate, approved deploy).

## Service-scoped deploy (Phase 3) + rollback (Phase 4)

For production Web-only / API-only updates and immutable-image rollback:

- `deploy/scripts/deploy-web.sh` / `deploy-api.sh`
- `deploy/scripts/rollback-web.sh` / `rollback-api.sh`
- State: `deploy/state/last-*-deploy.json` (gitignored)
- Retention tags: `seodeva-web:previous` / `seodeva-api:previous`

Rollback identity is the **Docker image ID** (`sha256:…`), not `:latest`. See `deploy/SERVICE-DEPLOY.md`.

**Do not prune** retained previous images if you need rollback without a registry.
