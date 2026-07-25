# Template Engine — Module 7 Pin Generation Integration

## Architecture

Pin Generation is an **orchestrator only**. It coordinates existing modules and does not re-implement them.

| Module | Role in pipeline |
|---|---|
| Content | Article / pin fields supplied by caller |
| Variables (M5) | `resolveVariablesInDocument` / export resolve-before-render |
| AI Image Provider | Existing `generateImagesWithProvider` via `ai_pin_image_jobs` queue |
| Template Engine | Read-only load + **deep clone** into run `template_snapshot` |
| Renderer (M2) | Inside Export → `renderDocument` / compositor |
| Export Engine (M6) | Profiles, formats, `RenderTarget` encode |
| Final Pin | Uploaded via `/ai-pin-images/composed` |

Templates (`ai_pin_templates`) are **never updated** during generation.

## Pipeline diagram

```text
┌──────────────┐
│   Content    │
└──────┬───────┘
       ▼
┌──────────────┐     ┌─────────────────────────┐
│  Variables   │◄────│ brand kit + image URL   │
└──────┬───────┘     └─────────────────────────┘
       ▼
┌──────────────────┐
│ AI Image Provider│  (existing jobs + adapters)
│  or featured/url │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Template clone   │  (snapshot on ai_pin_generation_runs)
│  read-only src   │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Renderer         │  (compositor)
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Export Engine    │  (profile + format + RenderTarget)
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Final Pin URL    │
└──────────────────┘
```

## Job lifecycle

Collection: `ai_pin_generation_runs` (metadata separate from templates).

```text
queued → preparing → generating_image → resolving_variables
      → rendering → exporting → completed
                 ↘ failed | cancelled
```

- Progress: `PIN_GENERATION_STAGE_PROGRESS`
- Steps: append-only JSON log on each stage
- Background: mirrored to `queue_jobs` as `template_rendering`
- AI stage: links `image_job_id`; worker notifies run via `generationRunId` in prompt payload

## API

| Method | Path |
|---|---|
| GET | `/ai-pin-images/generation/meta` |
| POST | `/ai-pin-images/generation/runs` |
| GET | `/ai-pin-images/generation/runs/:id` |
| POST | `/ai-pin-images/generation/runs/:id/advance\|complete\|fail\|cancel\|retry` |
| POST | `/ai-pin-images/generation/batch` |
| GET | `/ai-pin-images/generation/templates/:id/snapshot` |

## Client

```js
import { pinGenerationService } from '@/services/ai-pins';

await pinGenerationService.generate({
  templateId, // or templateConfiguration
  exportProfileId: 'pinterest_standard',
  format: 'png',
  imageProvider: 'openai',
  imageMode: 'generate_ai', // | use_featured | provided_url
  articleId,
  content: { title, description },
  onProgress via options
});
```

Existing `/ai-pin-images/jobs` and `composeAndUploadFeaturedPins` remain the default legacy paths.

## Error & retry strategy

| Class | Examples | Action |
|---|---|---|
| Recoverable | timeout, 429, network, upload transient | Re-queue run; `attempt_count++`; `next_retry_at` = attempt×60s (cap 5m) |
| Non-recoverable | validation, missing template, cancel | Terminal `failed` / `cancelled` |
| Image job | Existing queue retries | On success → run advances to `resolving_variables` |

## Compatibility

- v1 + v2 templates via Export `prepareExportDocument`
- Legacy AI-only and featured-compose flows unchanged
- Optional bridge: `generateFeaturedPinViaPipeline`

## Performance

- AI wait dominates (provider + poll)
- Compose/export is local canvas (same as M6)
- Batch creates runs without blocking; `executeLocally` opt-in for compose

## Future extensions (`extensions` JSON + helpers)

- Batch (`batchId`)
- A/B variants (`variantId`, `abGroup`)
- Multi-language (`locale`)
- Scheduled (`scheduleAt`)
- Team workspaces (`teamId`)
