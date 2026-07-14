# Production Deployment (Oracle Cloud Ubuntu)

## 1) Prepare server
- Ubuntu 22.04+
- Install Docker and Docker Compose plugin
- Open ports: 80, 443

## 2) Configure environment
- Copy `apps/api/.env.example` to `apps/api/.env`
- Fill all required secrets
- Ensure `PB_BASE_URL=http://pocketbase:8090` when using Docker Compose

## 3) TLS certificates
- Place cert files in `deploy/nginx/certs/`:
  - `fullchain.pem`
  - `privkey.pem`

## 4) Build and run
```bash
docker compose -f docker-compose.prod.yml up -d --build
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

## 7) File permissions
- Ensure execute permission on PocketBase binary:
```bash
chmod +x apps/pocketbase/pocketbase
```

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
