# Template Engine — Final Project Report (Module 8)

## Overall architecture summary

The Template Engine is a modular stack: **schema (M1) → renderer (M2) → editor (M3) → gallery (M4) → variables (M5) → export (M6) → pin generation (M7)**, with Module 8 production polish. UI talks to service facades; engines stay PocketBase/React-agnostic where required. Pin generation **orchestrates** modules and never mutates templates.

## Folder structure (engine-focused)

```text
apps/web/src/lib/                 # engines (schema, compositor, variables, export, generation)
apps/web/src/services/templates/  # editor/gallery/export facades
apps/web/src/services/ai-pins/    # pin generation facade + legacy compose
apps/web/src/components/templates/{editor,gallery}/
apps/web/src/pages/app/Templates*.jsx, TemplateEditorPage.jsx
apps/api/src/services/template-*.js, pin-generation.js
apps/api/src/constants/pin-engine.js, pin-generation.js
apps/api/src/utils/template-config-validation.js
apps/pocketbase/pb_migrations/178398*.js
docs/template-engine-*.md
```

## Module summary

| Module | Outcome |
|---|---|
| 1 Database | Collections, uuid/checksum/revision, schema docs |
| 2 Renderer | Compositor + PNG target, dual v1/v2 path |
| 3 Editor | Commands, history, Konva, autosave hooks |
| 4 Gallery | Paginated API + card UI + preview cache |
| 5 Variables | Registry, expressions, resolve-before-render |
| 6 Export | Profiles, jobs, RenderTarget pipeline |
| 7 Pin Gen | Orchestrator, runs metadata, provider reuse |
| 8 Polish | Perf selectors, a11y, validation, docs, checklist |

## Known limitations

- Pixel export primarily client-side; queue workers store plans only.
- JPG/WebP/PDF/SVG/MP4 are stubs.
- Classic atelier remains for v1 maintenance.
- AI Pins studio still defaults to legacy dual-path until product flips to `pinGenerationService`.
- Canvas keyboard editing is shortcut-level, not full a11y canvas.

## Future roadmap

1. Node canvas worker for background export/gen.
2. Implement remaining RenderTargets.
3. Asset upload library panel (extension slot ready).
4. Default AI Pins UI to Module 7 pipeline.
5. Shared constants codegen between web/api.

## Technical debt

- Mirrored `pin-engine` constants (manual sync).
- Large `pinCanvasRenderer.js` + compositor dual path (required for compat).
- `AIPinsPage.jsx` size — out of Module 8 scope to rewrite.

## Production readiness assessment

**Ready for staging** with migrations applied and checklist items marked. **Production** after: migrate PB, smoke gallery/editor/export PNG, one generation run (featured + AI), confirm RBAC and import validation. Remaining gaps are optional workers/formats/UI cutover — not blockers for template CRUD + PNG export.

## Module 8 polish highlights

- Selector-aware editor/gallery stores (fewer re-renders)
- Debounced gallery search
- Autosave persistence wired
- Preview object URL revoke + toast errors
- A11y labels, tabs, modal focus/Escape
- Responsive editor/gallery CSS
- Config validation + import size/format guards
- Bulk delete/archive confirmation
- Docs suite + checklist
