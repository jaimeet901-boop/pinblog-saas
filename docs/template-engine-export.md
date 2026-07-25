# Template Engine — Module 6 Export

## Architecture

The Export Engine is **completely independent** of the editor (Konva) and React.

```
React UI ──► exportService (facade)
                  │
                  ▼
           pinExportEngine
                  │
     ┌────────────┼────────────┐
     ▼            ▼            ▼
 profiles     validation    jobs/queue
 presets      watermark*    (cancellable)
     │            │
     └────┬───────┘
          ▼
  prepareExportDocument (normalize; v1→v2 in-memory)
          ▼
  applyExportCanvasSize + watermark pipeline
          ▼
  pinLayerCompositor.renderDocument
          ▼
  RenderTarget.encode (PNG today)
```

\* Watermark is a registered hook pipeline (pass-through by default).

## Pipeline

1. **Resolve** profile / preset / settings (width, height, DPI, quality, background, transparent, compression).
2. **Validate** request (`pinExportValidation`).
3. **Prepare** document — always normalize; migrate v1 procedural → v2 **in memory only** (never auto-save).
4. **Resize** layers to profile canvas.
5. **Watermark** hooks (optional / future).
6. **Render** via compositor + `RenderTarget` (provider-independent).
7. Return `{ bytes, mimeType, format, settings, durationMs }`.

## Profiles

| Id | Size |
|---|---|
| `pinterest_standard` | 1000×1500 |
| `pinterest_long` | 1000×2100 |
| `instagram_square` | 1080×1080 |
| `instagram_portrait` | 1080×1350 |
| `facebook_post` | 1200×630 |
| `facebook_story` | 1080×1920 |
| `custom` | caller width/height |

## Formats

| Format | Status |
|---|---|
| PNG | Implemented (`PngTarget`) |
| JPG / WebP / PDF / SVG / MP4 | Architecture stubs (`UNSUPPORTED_FORMAT`) |

## Jobs & queue

- Local: `AbortController` jobs + `createInMemoryExportQueue` / `createLocalExportQueue`.
- Remote: `createRemoteExportQueueAdapter` + API `POST /templates/export/enqueue` → PocketBase `queue_jobs` type `export` | `template_rendering`.
- Batch: `runExportBatch` with concurrency + `cancelExportBatch`.

## API (workspace)

| Method | Path | Purpose |
|---|---|---|
| GET | `/workspace/v1/templates/export/profiles` | Profiles + formats |
| POST | `/workspace/v1/templates/export/plan` | Validate plan (no pixels) |
| POST | `/workspace/v1/templates/export/enqueue` | Background job |
| POST | `/workspace/v1/templates/export/batch` | Batch plan / enqueue |
| POST | `/workspace/v1/templates/import` | Import JSON package |
| GET | `/workspace/v1/templates/:id/export` | JSON package (Module 4) |

## Client usage (no React logic)

```js
import { exportService } from '@/services/templates';

const { bytes } = await exportService.export({
  document,
  profileId: 'pinterest_standard',
  format: 'png',
  variables: { title: 'Hello' },
});
```

## Compatibility

- v1 templates export via in-memory `migrateV1ProceduralToV2`.
- v2 layer docs normalize then render.
- Existing JSON package export unchanged.
- Renderer / editor / gallery modules unchanged in responsibility.

## Future extension

1. Implement `JpgTarget` / `WebPTarget` / `PdfTarget` / `SvgTarget` / `Mp4Target` behind `getRenderTarget`.
2. Attach queue worker that loads plan → `runExport` (Node canvas / `@napi-rs/canvas`).
3. Register Brand Kit watermark hooks in `pinExportWatermark`.
4. Persist user presets per workspace.
5. Module 7 Pin Gen consumes `exportService` / queue — not the editor.
