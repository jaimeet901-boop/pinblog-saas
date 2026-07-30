# Facebook Channel Pack — F1-Apply Implementation Report

**Phase:** F1-Apply  
**Date:** 2026-07-30  
**Status:** Complete — stop before F2  

## Summary

Implemented the approved Facebook Channel Pack foundation: PocketBase collections/indexes (API-only), feature catalog key `facebook`, workspace RBAC permissions, publishing job collection map, and channel capability registry. No OAuth, Graph, publishing, or queue workers.

## Deliverables

| # | Deliverable | Location |
|---|-------------|----------|
| 1 | PocketBase migrations | `apps/pocketbase/pb_migrations/1785400000_facebook_channel_pack.js` |
| 2 | Collection registration | Migration + `FACEBOOK_COLLECTIONS` in `apps/api/src/services/facebook/channel-pack.js` |
| 3 | Feature catalog | `feature-catalog.js` key `facebook` (stage `reserved`) |
| 4 | Permissions | `workspace.facebook.manage` / `workspace.facebook.publish` in `workspace-rbac.js` + `docs/rbac.md` |
| 5 | Capabilities | `FACEBOOK_CHANNEL_CAPABILITIES` + plan seed `facebook: true` on Starter+ |
| 6 | Tests | `channel-pack.test.js`; feature-catalog assert; phase3 regression migration checks |
| 7 | Build verification | API unit tests (see below) |
| 8 | Documentation | Schema/ADR/database-schema/rbac + this report |
| 9 | Implementation report | This file |

## Collections created

`facebook_accounts`, `facebook_account_secrets`, `facebook_pages`, `facebook_oauth_states`, `facebook_publish_jobs`, `facebook_publish_events`, `facebook_publish_history`

All rules: API-only (`null`). Indexes per F1 design including `idx_isolation_facebook_*_workspace`.

## Explicitly not done

- OAuth / Graph API / `/facebook` routes  
- Publishing / schedule / queue workers  
- Content Studio behavior changes  
- Unified Calendar redesign  
- Pinterest code/schema changes  

## Deploy note

Run PocketBase migrate up (or restart PB with migrations dir) so `1785400000_facebook_channel_pack.js` applies. Until then, Calendar Facebook source remains empty-safe.

## Next phase

**F2** (OAuth + Hub) — only after separate approval.
