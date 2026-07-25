# Template Engine — API Reference

Base: `/workspace/v1` (auth + workspace middleware). Capabilities: `workspace.read`, `workspace.templates.manage`.

## Templates / Gallery

| Method | Path | Notes |
|---|---|---|
| GET | `/templates?view=gallery` | Paginated gallery filters/sort/scopes |
| POST | `/templates` | Create pin or catalog template |
| GET | `/templates/:id` | Detail |
| PATCH | `/templates/:id` | Update (config validated) |
| DELETE | `/templates/:id` | Soft delete / archive |
| POST | `/templates/bulk` | delete, archive, restore, duplicate, export |
| GET | `/templates/:id/export` | JSON package |
| POST | `/templates/:id/favorite` | Toggle favorite |
| POST | `/templates/:id/touch` | Recently used |
| POST | `/templates/:id/status` | draft/published/archived |
| GET/POST | `/templates/preview-cache` | Checksum-keyed preview |

## Export (Module 6)

| Method | Path |
|---|---|
| GET | `/templates/export/profiles` |
| POST | `/templates/export/plan` |
| POST | `/templates/export/enqueue` |
| POST | `/templates/export/batch` |
| POST | `/templates/import` | Requires `format: pinblog-template-package` |

Configuration payloads are size/shape validated (`template-config-validation.js`). Private-host image URLs rejected.

## Pin Generation (Module 7)

Base: `/ai-pin-images/generation` (auth).

| Method | Path |
|---|---|
| GET | `/meta` |
| POST | `/runs` |
| GET | `/runs/:id` |
| POST | `/runs/:id/advance\|complete\|fail\|cancel\|retry` |
| POST | `/batch` |
| GET | `/templates/:id/snapshot` | Read-only clone |

Legacy image jobs remain at `/ai-pin-images/jobs` (unchanged).
