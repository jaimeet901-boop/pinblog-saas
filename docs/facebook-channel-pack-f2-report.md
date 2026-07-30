# Facebook Channel Pack — F2 Implementation Report

**Phase:** F2 — OAuth + Hub + Admin  
**Date:** 2026-07-30  
**Status:** Complete — stop before F3 / publishing  

## Summary

Implemented Facebook OAuth (Meta Graph), encrypted token vault, Pages sync, workspace Facebook Hub, and Admin Console Facebook Accounts — paralleling Pinterest Accounts architecture without duplicating Pinterest modules or adding publish/queue.

## Deliverables

| # | Item | Location |
|---|------|----------|
| 1 | OAuth | `services/facebook/{app-credentials,scopes,secrets,api}.js`, `routes/facebook.js` |
| 2 | Hub | `pages/app/FacebookPage.jsx`, nav `/app/facebook` |
| 3 | Admin Console | `pages/admin/AdminFacebookPage.jsx`, `/admin/facebook`, `routes/admin/facebook.js` |
| 4 | Tests | `oauth.f2.test.js`, updated `channel-pack.test.js` |
| 5 | Migrations | `1785401000_facebook_oauth_platform.js` (`facebook_app_credentials` + oauth state fields) |
| 6 | Docs | This report + ADR phase lock |
| 7 | Env | `.env.example` Facebook vars |

## Features implemented

- Admin OAuth config: App ID, App Secret (encrypted), Redirect URI, scopes, enabled, pending flag  
- Connect / reconnect / disconnect  
- Long-lived token exchange + refresh endpoint  
- Sync Pages + default Page / default account  
- Account health status, last sync, error state  
- Audit logs on admin credential save + connect/reconnect/disconnect  
- RBAC: `workspace.facebook.manage` / `publish`  
- Tokens never returned in API DTOs  

## Explicitly not done (F3+)

- Destination adapter publish/schedule (Content Studio publish)  
- Publish routes / queue workers  
- Calendar changes  
- Pinterest code changes  

## Deploy notes

1. Run PocketBase migrate up (`1785400000` + `1785401000`).  
2. Configure Admin → Facebook Accounts (or env `FACEBOOK_APP_*`).  
3. Set Meta app redirect to `{API_PUBLIC_URL}/facebook/oauth/callback`.  

## Next phase

**F3** — Destination read path / validators — after separate approval.  
**Do not start publishing (F4).**
