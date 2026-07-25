# Template Engine — Developer Guide

## Where to put code

| Concern | Location |
|---|---|
| Shared enums | `apps/web/src/lib/pinEngineConstants.js` **and** `apps/api/src/constants/pin-engine.js` (keep in sync) |
| Document normalize / layers | `pinLayerSchema.js`, `pinLayerMigrate.js` |
| Variables | `pinVariable*.js` — register types/formatters; never hardcode in compositor |
| Pixels | `pinLayerCompositor.js` + `pinRenderTargets.js` |
| Export | `pinExport*.js` + `services/templates/exportService.js` |
| Editor state/commands | `services/templates/editor*.js` — React only via hooks |
| Gallery | `galleryStore.js`, `templatesApi.js` |
| Pin generation | `pinGenerationPipeline.js` + `services/ai-pins/pinGenerationService.js` |

## Adding a layer type

1. Add to `LAYER_TYPES` (web + api constants).
2. Teach `normalizeEditorDocument` / factory defaults.
3. Draw in `pinLayerCompositor.drawLayer`.
4. Add Konva node mapping in `KonvaLayerNode.jsx`.
5. Optional: Elements panel entry via `layerFactory`.

## Editor commands

All mutations go through `dispatchEditorCommand`. Do not mutate `document.layers` in React components.

## Autosave

`bindEditorAutosave({ onSave })` from the editor page. Store calls `schedule()` after commands; page performs PATCH/POST.

## Testing

```bash
cd apps/web && npm test -- --run
```

Vitest suites live under `apps/web/src/lib/__tests__/`.

## Sync check

When changing enums, update both constant files and `pinEngineConstantsModule8.test.js` expectations if needed.
