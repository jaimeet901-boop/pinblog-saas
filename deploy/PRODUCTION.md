# Production Deployment (Oracle Cloud Ubuntu)

## 1) Prepare server
- Ubuntu 22.04+
- Install Docker and Docker Compose plugin
- CloudPanel nginx remains the public web server on ports 80/443.
- Docker nginx is bound only to localhost high port (`APP_HTTP_PORT`, default `8080`).

## 2) Configure environment
- Copy `apps/api/.env.example` to `apps/api/.env`
- Fill all required secrets
- Ensure `PB_BASE_URL=http://pocketbase:8090` when using Docker Compose

## 3) TLS certificates
- In CloudPanel mode, TLS certificates are managed by CloudPanel nginx.
- No certificate files are required inside Docker nginx.

## 4) Build and run
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

CloudPanel reverse proxy target example:
- Proxy `https://YOUR_DOMAIN` to `http://127.0.0.1:8080`
- If you change `APP_HTTP_PORT`, update the CloudPanel proxy target accordingly.
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
- Do not commit `apps/pocketbase/pocketbase`; it is generated at runtime inside the mounted project folder.

## 8) Reverse proxy
- Main reverse proxy config: `deploy/nginx/reverse-proxy.conf`
- Web static config for containerized web image: `deploy/nginx/web.conf`

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
