# Seodeva Production Backup

This document describes the logical backup system for Seodeva production on EC2.

**Status:** Phase 1 complete (scripts + docs). **Daily systemd timer is enabled and active** (02:00 UTC). S3 lifecycle rules and EBS DLM are **NOT YET ENABLED**.

---

## What Is Backed Up

| Asset | Source path | S3 prefix |
|---|---|---|
| PocketBase data | `/home/ec2-user/pinblog-saas/apps/pocketbase/pb_data/` | `pb_data/daily/` |
| API environment | `/home/ec2-user/pinblog-saas/apps/api/.env` | `env/daily/` (inside env tarball) |
| Root build env | `/home/ec2-user/pinblog-saas/.env` | `env/daily/` |
| Host TLS edge config | `/etc/nginx/conf.d/seodeva.conf` | `env/daily/` |
| Backup manifest | generated JSON | `manifests/daily/` |

Each run produces **immutable UTC keys**:

```
pb_data/daily/pb_data-YYYYMMDDTHHMMSSZ.tar.gz
env/daily/env-YYYYMMDDTHHMMSSZ.tar.gz
manifests/daily/manifest-YYYYMMDDTHHMMSSZ.json
```

---

## What Is NOT Backed Up (by this system)

- Docker images (rebuild from git/worktree)
- `apps/pocketbase/pb_migrations/`, `pb_hooks/` (in git)
- `deploy/nginx/reverse-proxy.conf` (in git)
- Let's Encrypt certificates (renewable via certbot)
- Local Paddle/billing WIP files (not part of logical backup)
- Full-VM state (use separate **EBS snapshots** — **NOT YET ENABLED via DLM**)

---

## Infrastructure

| Item | Value |
|---|---|
| EC2 instance | `i-04f527450e0b45f81` |
| Region | `eu-north-1` |
| IAM role | `seodeva-pinblog-backup-role` |
| S3 bucket | `seodeva-pinblog-backups-106088256806` |
| Root volume | `vol-09fc8832652105531` (20 GiB gp3) |

S3 bucket settings (verified manually in Console):

- Block Public Access: **ENABLED**
- Default encryption: **SSE-S3**
- Versioning: **ENABLED**

---

## Security Model

- Backups run as **root** (required for root-owned `pb_data/` files and docker control).
- Secrets are **never printed** to logs.
- Temporary archives are created under `/var/tmp/seodeva-backup.*` with mode `700`; archives mode `600`.
- S3 bucket is private; IAM role scoped to backup prefixes only.
- Env tarball contains secrets — treat manifests and env archives as confidential.
- Script **never deletes** existing S3 backups.
- Script **never overwrites** an existing S3 key (pre-flight uniqueness check).
- Manifest is uploaded **last** and only when `status=complete`.

---

## Backup Process

1. Acquire lock (`/var/run/seodeva-backup.lock`)
2. Verify AWS identity (`seodeva-pinblog-backup-role`)
3. Verify disk space (>= 512 MiB free)
4. Verify S3 keys are unique
5. **Stop ONLY PocketBase** (~1.5–3 min downtime window)
6. SQLite `integrity_check` on `data.db` and `auxiliary.db` (sqlite3 or python3; skipped if neither available)
7. SQLite WAL checkpoint/finalization (may remove **empty** `-wal`/`-shm` sidecars while PocketBase is stopped)
8. Create and validate `pb_data` tar.gz
9. **Start PocketBase** and wait for healthy
10. Create and validate env tar.gz (approved files only)
11. Upload pb_data archive
12. Upload env archive
13. Write manifest JSON with checksums and durations
14. Upload manifest **last**
15. Remove local temp files

### Failure behavior

- On any failure: exit non-zero, **no complete manifest uploaded**
- If PocketBase was stopped: script attempts **emergency restart** via trap
- Production `pb_data/` is **never deleted or overwritten**; during the controlled backup window (PocketBase stopped), the script runs SQLite WAL checkpoint/finalization and may remove **empty** `-wal`/`-shm` sidecars
- Partial S3 objects may exist without a manifest (incomplete set — do not use for restore)

---

## RPO / RTO

| Metric | Target |
|---|---|
| **RPO** | 24 hours (daily schedule) |
| **RTO** | < 30 minutes for logical pb_data + env restore |

---

## Manual Execution

Ad-hoc runs use the same script as the systemd timer:

```bash
sudo /home/ec2-user/pinblog-saas/deploy/scripts/backup-seodeva.sh
```

**Production status:** `seodeva-backup.timer` is **enabled and active** (daily 02:00 UTC). An automated run completed successfully on **2026-08-28 02:00 UTC** (`manifest-20260828T020008Z`).

---

## Verification (read-only)

After a backup exists:

```bash
/home/ec2-user/pinblog-saas/deploy/scripts/verify-backup-manifest.sh \
  --manifest s3://seodeva-pinblog-backups-106088256806/manifests/daily/manifest-YYYYMMDDTHHMMSSZ.json

# Optional checksum verification (downloads archives):
/home/ec2-user/pinblog-saas/deploy/scripts/verify-backup-manifest.sh \
  --manifest s3://seodeva-pinblog-backups-106088256806/manifests/daily/manifest-YYYYMMDDTHHMMSSZ.json \
  --download
```

---

## Restore Process

### Default: isolated restore drill (safe)

```bash
/home/ec2-user/pinblog-saas/deploy/scripts/restore-seodeva-pb-data.sh \
  --manifest s3://seodeva-pinblog-backups-106088256806/manifests/daily/manifest-YYYYMMDDTHHMMSSZ.json \
  --download
```

This extracts into `/var/tmp/seodeva-restore-test.*` and validates checksums + SQLite integrity. **Does not touch production.**

### Production restore

Not automated in Phase 1. Requires explicit manual steps documented in `restore-seodeva-pb-data.sh` after isolated drill passes. The `--production-restore` flag is guarded and exits with instructions rather than overwriting production by default.

---

## Automation

### Systemd timer (enabled on production host)

Files:

- `deploy/systemd/seodeva-backup.service`
- `deploy/systemd/seodeva-backup.timer` (02:00 UTC daily)

On this EC2 host, the timer is **enabled and active**; the next scheduled run is daily at **02:00 UTC**. First verified successful automated run: **2026-08-28 02:00 UTC**.

Install or reinstall on a new host:

```bash
sudo cp deploy/systemd/seodeva-backup.service /etc/systemd/system/
sudo cp deploy/systemd/seodeva-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable seodeva-backup.timer
sudo systemctl start seodeva-backup.timer
```

### S3 lifecycle rules (NOT YET ENABLED)

Recommended in Console:

- Expire `pb_data/daily/` objects after 7 days
- Expire `env/daily/` after 30 days
- Expire `manifests/daily/` after 30 days

### EBS snapshots via DLM (NOT YET ENABLED)

Daily snapshot of `vol-09fc8832652105531`, retain 7–30 days. Complements logical backup; zero downtime.

---

## Scripts

| Script | Purpose |
|---|---|
| `deploy/scripts/backup-seodeva.sh` | Main backup orchestration |
| `deploy/scripts/restore-seodeva-pb-data.sh` | Isolated restore validation |
| `deploy/scripts/verify-backup-manifest.sh` | Read-only manifest/archive verification |

---

## Dependencies

- `aws` CLI v2 with instance profile credentials
- `docker` + `docker compose`
- `python3` (manifest JSON, checksum helpers, optional SQLite validation)
- `tar`, `gzip`, `sha256sum`, `curl`, `flock`
- Optional: `sqlite3` CLI (falls back to python3)
- `git` (optional — records commit in manifest)

---

## Related

- Operational runbook: [RUNBOOK.md](./RUNBOOK.md)
