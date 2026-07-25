# Template Engine — Architecture Overview

PinBlog Template Engine is a layered system. Each module owns one concern; later modules orchestrate earlier ones without embedding their logic.

```text
┌─────────────────────────────────────────────────────────────┐
│ UI (Gallery / Editor / AI Pins)                             │
│  services/templates + services/ai-pins (no business in JSX) │
└───────────────────────────┬─────────────────────────────────┘
                            │
     ┌──────────────────────┼──────────────────────┐
     ▼                      ▼                      ▼
 Variables (M5)        Export (M6)          Pin Generation (M7)
     │                      │                      │
     └──────────┬───────────┴──────────┬───────────┘
                ▼                      ▼
         Renderer / Compositor (M2)   AI Image Providers
                ▲
         Document model (M1 schema + M3 editor commands)
```

## Dual document paths

| Path | Shape | Used by |
|---|---|---|
| v1 procedural | `canvas` + typography/layout (no `layers[]`) | Legacy classic atelier, featured compose fallback |
| v2 layers | `editorVersion: 2`, `layers[]` | Layer editor, gallery, export, pin generation |

Migrations are optional and **in-memory** for export/gen — never forced onto stored templates.

## Routes

| Route | Purpose |
|---|---|
| `/app/ai-pins/templates` | Gallery (primary) |
| `/app/ai-pins/templates/:id/edit` | Layer editor |
| `/app/ai-pins/templates/classic` | Legacy atelier (maintenance) |

## Persistence

PocketBase collections (`ai_pin_templates`, versions/assets/favorites/preview cache, `ai_pin_generation_runs`). API enforces RBAC via workspace capabilities. Preview cache keys use **config checksum**, not timestamps.
