# Facebook Channel Pack — Release Checklist

**Pack:** Facebook Channel Pack (AI Facebook Pages)  
**Release baseline:** `origin/main` @ `c8720bf` (F8-4 complete, pre-F8-5 documentation)  
**Certification:** [F8 Certification Report](./facebook-channel-pack-f8-certification-report.md)  
**Architecture:** [Architecture ADR](./facebook-channel-pack-architecture.md)  
**Operations:** [Operations Guide](./facebook-channel-pack-operations.md)

**Related phase certifications:** [F6](./facebook-channel-pack-f6-certification-report.md) · [F7](./facebook-channel-pack-f7-certification-report.md) · [F8](./facebook-channel-pack-f8-certification-report.md)

---

## 1. Pre-Release Baseline (verified at F8-4)

| Check | Expected | Verified |
|-------|----------|----------|
| API test suite | **573 / 573** pass | ✅ |
| Web test suite | **267 / 267** pass | ✅ |
| Local HEAD | `c8720bf` | ✅ |
| `origin/main` | `c8720bf` | ✅ |
| HEAD == origin/main | **Yes** | ✅ |
| Working tree (pre-F8-5 docs) | Clean at F8-4 push | ✅ |

---

## 2. Phase Completion

| Phase | Name | Status |
|-------|------|--------|
| F0 | Architecture lock | ✅ Complete |
| F1 | Schema + feature catalog design | ✅ Complete |
| F1-Apply | PB migrations + catalog + permissions | ✅ Complete |
| F2 | OAuth + Hub + Admin | ✅ Complete |
| F3 | Destination read path | ✅ Complete |
| F4 | Publish now + queue | ✅ Complete |
| F5 | Schedule + Calendar verify | ✅ Complete |
| F6 | Studio packs | ✅ Complete — [F6 cert](./facebook-channel-pack-f6-certification-report.md) |
| F7 | Publishing history + insights | ✅ Complete — [F7 cert](./facebook-channel-pack-f7-certification-report.md) |
| F8 | Hardening / naming / release docs | ✅ Complete — [F8 cert](./facebook-channel-pack-f8-certification-report.md) |

---

## 3. Capability Flags

Verify in API (`channel-pack.js`) and web channel capabilities:

| Flag | Expected | Route / Surface |
|------|----------|-----------------|
| `publishingHistory` | `true` | `/app/facebook-history`, `GET /facebook/history` |
| `insights` | `true` | F7-4 sync worker → job `performance` |
| `analytics` | `true` | `/app/facebook` Analytics tab, `GET /facebook/analytics` |

---

## 4. Smoke Verification

### Pinterest smoke (regression)

| Step | Pass criteria |
|------|---------------|
| Connect Pinterest account | OAuth completes; account appears in Hub |
| Publish pin from AI Pins studio | Job created; status reaches `published` or `scheduled` |
| Calendar shows Pinterest item | Unified calendar facade returns `pinterest:*` events |
| Publishing history | `/app/pinterest-history` loads; rows render |
| Analytics | `/pinterest/analytics` returns metrics |
| Automated regression | API 573/573 · Web 267/267 (Pinterest paths unchanged in F8 diff) |

### Facebook smoke

| Step | Pass criteria |
|------|---------------|
| Connect Facebook account | OAuth completes; account + pages sync |
| Publish post from AI Facebook Pages studio | Job created via `POST /facebook/publish` |
| Schedule post | `POST /facebook/schedule`; job appears on calendar |
| Calendar shows Facebook item | Provider maps `facebook_publish_jobs` → Scheduled Item |
| Publishing history | `/app/facebook-history` loads; Page labels (not Board) |
| Analytics tab | Hub loads `/facebook/analytics`; stat cards render |
| Insights sync | Worker env vars documented in [operations guide](./facebook-channel-pack-operations.md) |

---

## 5. Frozen Subsystem Verification

Confirm release diff does **not** modify:

| Subsystem | Must remain untouched |
|-----------|----------------------|
| Queue Engine | `apps/api/src/services/queue/engine.js` |
| Calendar core | `calendar/facade.js`, `mutations/router.js` |
| Graph publish | `facebook/graph-publish.js` |
| OAuth | `facebook/oauth-readiness.js`, token lifecycle |
| Credits | `credits-engine.js`, `facebook-publish-credits.js` |
| Schema / Migrations | `apps/pocketbase/pb_migrations/**` (no new FB migrations in F8) |

Static boundary guards: `facebook-f8-2.test.js`, `facebook-f8-4.test.js`.

---

## 6. API Surface (release-critical endpoints)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/facebook/oauth/start` | Start OAuth |
| GET | `/facebook/oauth/callback` | OAuth callback |
| GET | `/facebook/accounts` | List accounts |
| GET | `/facebook/pages` | List pages |
| POST | `/facebook/publish` | Publish now |
| POST | `/facebook/schedule` | Schedule post |
| GET | `/facebook/history` | Publishing history (unified pipeline) |
| GET | `/facebook/analytics` | Analytics rollup (read-only) |
| GET | `/facebook/jobs` | Job list / poll |
| POST | `/facebook/jobs/:id/retry` | Retry failed job |
| POST | `/facebook/jobs/:id/cancel` | Cancel scheduled job |

Full contract: [api-contracts.md §2.8](./api-contracts.md)

---

## 7. Environment & Operations

| Variable | Required | Notes |
|----------|----------|-------|
| `PB_SUPERUSER_EMAIL` | Production | PocketBase access for workers |
| `FACEBOOK_ANALYTICS_ENABLED` | Optional | Default enabled; set `0` to disable insights worker |
| `FACEBOOK_ANALYTICS_POLL_MS` | Optional | Default 15 min |
| Meta app credentials | Production | Admin console + OAuth |

See [facebook-channel-pack-operations.md](./facebook-channel-pack-operations.md).

---

## 8. Deploy Sign-Off

| Gate | Owner | Status |
|------|-------|--------|
| API tests green (573/573) | CI / release engineer | ☐ |
| Web tests green (267/267) | CI / release engineer | ☐ |
| F8 certification approved | Engineering | ☐ |
| Pinterest smoke pass | QA | ☐ |
| Facebook smoke pass | QA | ☐ |
| Migrations applied (F1-Apply only) | DevOps | ☐ |
| Feature flag `facebook` enabled for target plan | Product | ☐ |
| Operations env vars set | DevOps | ☐ |

---

## 9. Post-Release Monitoring

- Facebook publish queue worker health (`facebook-publish-queue.js`)
- Insights sync worker logs (`FACEBOOK_ANALYTICS_*` tuning)
- Graph API error rates on publish/retry
- Calendar mutation success rate for `facebook:*` events
- Publishing history empty-state vs scope errors (F8-3 read-path guards)

---

*Checklist version: F8-5 · Baseline `c8720bf`*
