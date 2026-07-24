# Workspace Config Migration Report

Status after Phase 1 (platform core) + Phase 2 (AI Pins Studio consumer) verification cleanup.

Date: 2026-07-24  
Commits: `e9a553f` (Phase 1), `76e4786` (Phase 2), plus follow-up cleanup commit.

---

## Old configuration sources removed (AI Pins Studio)

| Former source | How Studio used it | Status |
|---|---|---|
| Hardcoded `IMAGE_QUALITIES` (`openai` / `fal`) | Provider chips + generate mode | **Removed** — derived from `config.imageProviders` + `config.images` |
| Hardcoded provider `<option>`s | Advanced image provider select | **Removed** — maps `config.imageProviders` |
| Hardcoded `PIN_STYLES` array in page | Style dropdown | **Removed** — `config.pinStyles` / `content.pinStyles` |
| Hardcoded `PIN_COUNTS` | Pin count select | **Removed** — derived from `config.limits.pinsPerBatch` |
| Hardcoded `buildPinPrompt(...)` system text | Client AI generation | **Removed** — `config.prompts.pinSystem` / `pinUser` |
| PocketBase `ai_pin_templates.getFullList` | Template dropdown | **Removed** — `config.templates` (includes `configuration`) |
| `GET /ai-pins/credits` | Credits chip | **Removed from Studio** — `config.credits` (endpoint deprecated, kept for compatibility) |
| `GET /ai-pins/brand-kits` (read) | Brand kit dropdown | **Removed from Studio** — `config.brandKits` (CRUD endpoints remain for Brand Kit page) |
| Hardcoded brand strings `"Chef IA …"` | Headers | **Removed** — `config.general.platformName` |
| Hardcoded tone / audience / language seeds | Panel defaults | **Removed** — `content.recipeStyle` / `defaultPinTone` / `defaultPinAudience` / `general.defaultLanguage` |
| Hardcoded credit estimate `0.7` / `0.5` | UX estimate | **Removed** — `images.estimateCreditsPerAiPin` via config |

Studio no longer calls `/admin/v1/*` and does not maintain a parallel settings store.

---

## New Workspace Config sources (AI Pins Studio)

All platform/workspace configuration is read only through:

```js
const { config, isFeatureEnabled, refresh, configVersion, ... } = useWorkspaceConfig();
```

| Concern | Config path |
|---|---|
| Image providers / qualities | `config.imageProviders`, `config.images.*` |
| Text / image models | `config.textModels`, `config.imageModels`, `config.models` |
| Prompts | `config.prompts` |
| Credits (incl. ai/image split) | `config.credits` |
| Feature flags | `config.featureFlags` / `isFeatureEnabled()` |
| Templates (+ configuration) | `config.templates` |
| Brand kits | `config.brandKits` |
| Pin styles | `config.pinStyles` |
| Limits (batch size) | `config.limits.pinsPerBatch` |
| Publishing / ratio / timezone | `config.pinterest`, `config.publishingRules`, `config.schedulingDefaults`, `config.general` |
| Watermark / typography | `config.watermark`, `config.typographyHints` |

Helpers live in `apps/web/src/lib/aiPinsWorkspaceConfig.js` (pure mapping from config → UI options).

Live reload: `WorkspaceConfigProvider` SSE + poll; Studio also calls `refresh()` after analyze / prompt / generate.

---

## Remaining modules still using legacy configuration

These modules have **not** been migrated to `useWorkspaceConfig()` yet. They keep existing APIs and local defaults (by design until their migration phase).

| Module | Legacy pattern | Notes |
|---|---|---|
| **Images** (`ImagesPage.jsx`) | Hardcoded `FORMATS`, `QUICK_STYLES`, credit factors; loads brand kits via `/ai-pins/brand-kits` | Next candidate |
| **AI Writer** (`WriterPage.jsx`) | Local article defaults / scoring; no Workspace Config | Next candidate |
| **Brand Kit page** | Form blanks (`Inter`, hex colors); CRUD via `/ai-pins/brand-kits` | CRUD stays; list/seed should use config |
| **Templates page** | Uses `/workspace/v1/templates` (good) but not `useWorkspaceConfig()` for platform fields | Partial |
| **Pinterest / Calendar / Analytics / History / Settings / Subscription** | Operational APIs + local UX constants | Migrate flags/limits/timezone when needed |
| **Admin Console** | Writes via `/admin/v1/*` | Correct — Admin remains sole writer |

### API endpoints retained (deprecated for Studio config reads)

- `GET /ai-pins/styles` → prefer `config.pinStyles`
- `GET /ai-pins/credits` → prefer `config.credits`

Still used server-side: `getUserCreditUsage` / `consumeCredits` for billing enforcement during analyze/prompt/image jobs.

---

## Verification checklist (this pass)

- [x] AI Pins Studio has no hardcoded OpenAI/Fal provider lists
- [x] AI Pins Studio does not fetch `/ai-pins/credits`, `/ai-pins/styles`, or PocketBase templates for config
- [x] Single public config endpoint: `GET /workspace/v1/config`
- [x] Single frontend config source: `WorkspaceConfigProvider` / `useWorkspaceConfig()`
- [x] No duplicated Studio settings store
- [x] Architecture docs updated (`docs/workspace-config.md` + this report)
- [x] Build / lint / tests green after cleanup

---

## Explicit non-goals of this cleanup

- Did not migrate Images / Writer / Brand Kit / Templates pages
- Did not redesign AI Pins UI or generation pipeline
- Did not delete `/ai-pins/credits` or `/ai-pins/styles` (compatibility)
- Did not change Pinterest-related uncommitted work
