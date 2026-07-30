# Calendar architecture (Chef IA)

**Status:** Phase **C10** complete — Unified Calendar finalized. Orphan CE publish merge retired.  
**Last updated:** 2026-07-30

## Decision lock

### Channel-agnostic Calendar

Calendar core understands only generic Scheduled Items and dispatches mutations by channel id.
No Pinterest / WordPress / Facebook / Studio write logic belongs in the facade or mutation router core.

| Role | Choice |
|------|--------|
| Product Calendar API | Unified Calendar Facade + Mutation Router (`GET /workspace/v1/calendar/events`) |
| Write Source of Truth | Channel job collections (`pinterest_publish_jobs`, `publish_jobs`, `facebook_publish_jobs`, …) |
| Calendar core | Channel-agnostic Scheduled Items only |
| `calendar_events` | Manual / planned overlay only (optional product overlay via `includeManual`) |

### Dual-write freeze

Channel publish schedules must not be written into `calendar_events`.

## C10 — Retire orphan CE publish merge

| Change | Detail |
|--------|--------|
| Removed | Interim PPJ → `listCalendarEvents` dual-read merge |
| Legacy `GET /workspace/v1/calendar` | Returns `calendar_events` only; excludes orphan channel-job mirror rows |
| Product surfaces | Unchanged — CalendarPage + Dashboard already on Unified Facade |
| Dual-write freeze | Kept |
| Manual CE CRUD | Kept for planned/manual events |
| Facade / Mutation Router | Architecture unchanged |

### Source of truth (verified)

1. **Scheduled publishing writes:** channel job tables via channel mutation adapters only.
2. **Scheduled publishing reads (product):** Unified Facade providers projecting canonical Scheduled Items.
3. **`calendar_events`:** never a publish SoT; never merged with PPJ on the legacy list.

## C9–C0 (complete)

Facebook / WordPress / Pinterest providers + adapters; Studio + drafts; C8 Queue / Analytics / Notification projections; Mutation Router; statuses + website; Dashboard + CalendarPage on facade; CE-first path removed; dual-write freeze.

## Phase gate

| Phase | Status |
|-------|--------|
| **C0–C9** | Complete |
| **C10** Retire orphan CE publish merge | **Complete (this phase)** |

## Architecture verification (C10)

- Facade core: channel-agnostic aggregation only.
- Mutation router core: channel-agnostic dispatch only.
- Provider registry: Pinterest, WordPress, Facebook, Studio, draft overlay, manual overlay.
- Mutation registry: Pinterest, WordPress, Facebook.
- No Dashboard/API path prefers empty CE over channel jobs.

## Tests

```bash
cd apps/api
node --test src/services/calendar/**/*.test.js src/services/calendar/*.test.js src/services/calendar/providers/*.test.js src/services/calendar/mutations/*.test.js src/services/calendar/projections/*.test.js src/services/calendar-c10-finalization.test.js
```
