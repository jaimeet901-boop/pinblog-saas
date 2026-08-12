# Production Deployment (Oracle Cloud Ubuntu)

## 1) Prepare server
- Ubuntu 22.04+
- Install Docker and Docker Compose plugin
- CloudPanel nginx remains the public web server on ports 80/443.
- Docker nginx is bound only to localhost high port (`APP_HTTP_PORT`, default **`18080`**).

## 2) Configure environment
- Copy `apps/api/.env.example` to `apps/api/.env`
- Fill all required secrets
- Ensure `PB_BASE_URL=http://pocketbase:8090` when using Docker Compose
- AI Pins / Writer text generation uses **Admin Providers** (Google Gemini adapter) — no external Integrated AI proxy.
- Ensure Gemini is enabled with a valid API key in Admin → Providers.
- Optional legacy vars `INTEGRATED_AI_API_URL` / `INTEGRATED_AI_API_KEY` / `WEBSITE_ID` are unused by the current text path.

### API environment loading (deploy parity)

All paths read configuration from `apps/api/.env`, but the loading mechanism differs by runtime:

| Runtime | How env is loaded |
|---------|-------------------|
| **Docker Compose** | `docker-compose.prod.yml` `env_file: ./apps/api/.env` injects variables into the API container process. `Dockerfile.api` runs `node src/main.js` without `--env-file` because the file is not copied into the image. |
| **PM2** | `ecosystem.config.cjs` sets `cwd: ./apps/api` and `node_args: '--env-file=.env'`. Start from repo root: `pm2 start ecosystem.config.cjs`. |
| **Root / local npm** | `npm run start --prefix apps/api` runs `node --env-file=.env src/main.js` (see `apps/api/package.json`). Root `npm test` delegates to the same workspace test script. |

Do not add `--env-file` to `Dockerfile.api` while Compose also uses `env_file`; that would duplicate or conflict with injected env. For PM2 and local starts, ensure `apps/api/.env` exists before starting the API.

## 3) TLS certificates
- In CloudPanel mode, TLS certificates are managed by CloudPanel nginx.
- No certificate files are required inside Docker nginx.

## 4) Build and run
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

CloudPanel reverse proxy target example (e.g. `seodeva.com`):
- Proxy `https://seodeva.com` to `http://127.0.0.1:18080`
- If you change `APP_HTTP_PORT`, update the edge proxy target accordingly.
- No Docker service should bind directly to public `80/443`.

Container verification (Oracle server):
```bash
docker compose -f docker-compose.prod.yml ps
```
- Ensure `pocketbase`, `api`, `web`, and `nginx` are `Up`.
- Ensure restart count is `0` for all services:
```bash
for s in pocketbase api web nginx; do \
	cid=$(docker compose -f docker-compose.prod.yml ps -q "$s") && \
	echo "$s restarts: $(docker inspect -f '{{.RestartCount}}' "$cid")"; \
done
```

## 5) Health verification
- API health: `https://YOUR_DOMAIN/api/health`
- Status includes database, queue, and redis configuration state.
- Quick smoke checks:
```bash
bash deploy/scripts/health-smoke.sh https://YOUR_DOMAIN
```
```powershell
powershell -ExecutionPolicy Bypass -File deploy/scripts/health-smoke.ps1 -BaseUrl https://YOUR_DOMAIN
```

## 6) PM2 alternative (without Docker)
```bash
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

## 7) PocketBase binary handling
- Docker Compose now downloads the correct Linux PocketBase binary automatically based on server architecture (`amd64`/`arm64`) using `apps/pocketbase/.pocketbase-version`.
- Downloaded PocketBase archives are validated against upstream `checksums.txt` before extraction.
- Do not commit `apps/pocketbase/pocketbase`; it is generated at runtime inside the mounted project folder.

## 8) Reverse proxy
- Main reverse proxy config: `deploy/nginx/reverse-proxy.conf`
- Web static config for containerized web image: `deploy/nginx/web.conf`
- Docker nginx sets `client_max_body_size 25m` for AI Pin image uploads (`POST /api/ai-pin-images/composed`).
- If CloudPanel (or another edge nginx) fronts Docker, set the same limit there — otherwise Save Draft returns **413 Payload Too Large**.

## 9) Rollback strategy
- Keep previous container image tags
- Rollback with:
```bash
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
```

## 10) Operations runbook
- See `deploy/RUNBOOK.md` for incident handling, queue recovery checks, and post-incident process.

## 11) Go-live checklist
- See `deploy/GO_LIVE_CHECKLIST.md` for pre-migration, migration window, validation, monitoring, and rollback sign-off.

## 12) Oracle quick commands
```bash
DOMAIN=YOUR_DOMAIN bash deploy/scripts/oracle-go-live.sh
```

One-shot clean-server verification (build + up + stability checks):
```bash
DOMAIN=YOUR_DOMAIN bash deploy/scripts/oracle-verify-compose.sh
```

Rollback:
```bash
bash deploy/scripts/oracle-rollback.sh
```
