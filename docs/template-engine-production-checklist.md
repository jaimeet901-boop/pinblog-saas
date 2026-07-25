# Template Engine — Production Readiness Checklist

## Database
- [x] Additive migrations for templates, assets, favorites, preview cache, generation runs
- [x] `template_uuid`, `config_checksum`, `revision` on templates
- [x] Soft delete / audit fields where required
- [ ] Run migrations on staging + verify script before prod cutover

## API
- [x] Gallery / CRUD / export package / import
- [x] Export plan + enqueue hooks
- [x] Pin generation run lifecycle
- [x] Configuration validation + name/meta sanitization
- [x] Capability checks (`workspace.read` / `workspace.templates.manage`)

## Renderer
- [x] Compositor + PNG `RenderTarget`
- [x] Resolve-before-render variables
- [x] Mock surface for tests
- [ ] Optional: off-main-thread / Node canvas worker

## Editor
- [x] Command bus, undo/redo, Konva interaction
- [x] Autosave wired to persistence
- [x] A11y labels on primary chrome
- [x] Responsive stacking for tablet/mobile
- [ ] Full keyboard canvas editing (beyond shortcuts)

## Gallery
- [x] Filters, infinite scroll, favorites, bulk (with confirm)
- [x] Debounced search
- [x] Preview modal focus + Escape
- [x] Empty / error / loading states

## Variables
- [x] Registry, namespaces, formatters, validation
- [x] No hardcoding in renderer

## Export
- [x] Profiles, presets, validation, batch, cancellable jobs
- [x] PNG live; other formats stubbed
- [ ] Server-side pixel worker

## Pin Generation
- [x] Orchestrator + stages + retries + metadata collection
- [x] Uses existing providers + export engine
- [x] Templates read-only during generation
- [ ] UI switch on AIPinsPage to default integrated path (Module 8 intentionally skipped new UX)

## Docs
- [x] Architecture, developer guide, API, deployment, per-module docs
- [x] Final project report (this Module 8 deliverable)
