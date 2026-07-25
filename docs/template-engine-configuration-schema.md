# Template Engine — Configuration JSON Schema

**Status:** Canonical specification for Modules 2+.  
**Storage:** PocketBase `ai_pin_templates.configuration` (JSON).  
**Renderer contract:** The compositor consumes a **normalized in-memory document only**. It must never import PocketBase, API clients, or AI provider SDKs.

Related: [Architecture](./template-engine-architecture.md) · [Developer guide](./template-engine-developer-guide.md) · [API](./template-engine-api.md) · [schema versioning](./template-engine-schema-versioning.md) · registries in `apps/web/src/lib/pinEngineConstants.js` and `apps/api/src/constants/pin-engine.js`.

---

## 1. Document kinds

| Kind | Detection | `editorVersion` | `schemaVersion` |
|------|-----------|-----------------|-----------------|
| **v1 procedural** | No `layers[]` (or `editorVersion` ≠ 2) | `1` (implicit) | `1` (implicit) |
| **v2 layer document** | `editorVersion === 2` **and** `Array.isArray(layers)` | `2` | `2` (current layer schema) |

Opening or generating with a v1 template **never** forces a save to v2.

---

## 2. Record-level fields (collection, not JSON)

| Field | Purpose |
|-------|---------|
| `id` | PocketBase record id (may change only if row is recreated) |
| `template_uuid` | **Immutable** public UUID for the template identity across export/import/migrate |
| `config_checksum` | SHA-256 (hex) of canonicalized `configuration` JSON |
| `revision` | Optimistic lock counter; increment on every successful write |
| `schema_version` | Denormalized from JSON `schemaVersion` |
| `editor_version` | Denormalized from JSON `editorVersion` |

Preview cache keys and invalidation use **`config_checksum`**, never `updated` timestamps.

---

## 3. v1 procedural document (schemaVersion 1)

Shape produced/consumed by `normalizeTemplateConfig` / `pinCanvasRenderer` (unchanged).

Top-level keys: `canvas`, `background`, `placeholders`, `layout`, `textOverlay`, `positions`, `typography`, `decorations`, `brandBar`, `buttonStyle`, `container`.

Variables in text fields use the historical subset (`{{title}}`, `{{description}}`, `{{category}}`, `{{website}}`, `{{author}}`) plus any tokens the legacy `applyTemplateVariables` path supports.

---

## 4. v2 layer document (schemaVersion 2)

### 4.1 Root

```json
{
  "editorVersion": 2,
  "schemaVersion": 2,
  "canvas": { "width": 1000, "height": 1500 },
  "category": "recipes",
  "meta": {
    "brandKitId": null,
    "variantGroupId": null,
    "autoLayoutProfile": null,
    "marketplaceMeta": null
  },
  "groups": [],
  "layers": []
}
```

| Field | Type | Rules |
|-------|------|-------|
| `editorVersion` | number | Must be `2` for layer path |
| `schemaVersion` | number | Document schema; compositor branches on this |
| `canvas.width` / `canvas.height` | number | Clamped to safe ranges (400–4000 / 400–6000) |
| `category` | string | Prefer `TEMPLATE_CATEGORIES` |
| `meta` | object | Reserved bridges; all nullable |
| `groups` | array | See groups |
| `layers` | array | Ordered list; draw order also respects `zIndex` |

### 4.2 Group

```json
{
  "id": "grp_…",
  "name": "Title Block",
  "childIds": ["lyr_a", "lyr_b"],
  "locked": false,
  "visible": true
}
```

### 4.3 Layer (common)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique; prefix `lyr_`; never reuse |
| `type` | string | One of `LAYER_TYPES` |
| `name` | string | Display name |
| `x`, `y`, `width`, `height` | number | Local coordinates in canvas px |
| `rotation` | number | Degrees |
| `opacity` | number | 0–1 |
| `borderRadius` | number | px |
| `zIndex` | number | Higher draws later |
| `visible` | boolean | Hidden layers are skipped |
| `locked` | boolean | Editor-only; compositor ignores |
| `groupId` | string\|null | Optional group membership |
| `props` | object | Type-specific |

### 4.4 Type `props` (summary)

| `type` | Key props |
|--------|-----------|
| `background` | `color`, `imageSrc` (URL or `{{image}}`) |
| `image` / `aiImage` | `src`, `fit` (`cover`\|`contain`\|`fill`), `focusX`, `focusY` |
| `text` | `text`, `fontFamily`, `fontSize`, `fontWeight`, `color`, `align`, `lineHeight`, `maxLines`, `shadow` |
| `shape` | `shape` (`rect`\|`ellipse`), `fill`, `stroke`, `strokeWidth` |
| `badge` / `cta` | `text`, `fill`, `textColor`, `padding`, `fontSize` |
| `sticker` / `logo` | `src`, `fit` |
| `divider` | `color`, `thickness` |
| `gradient` | `colors[]`, `angle` (degrees) |

Image/`src` values may be absolute URLs or variable tokens. They must **never** encode an AI provider name.

---

## 5. Normalized template document (renderer input)

After `normalizeEditorDocument(raw)`:

- Stable field names (camelCase)
- Clamped numbers / validated enums
- Unique layer ids ensured
- Layers sorted by `zIndex` then array order
- Invisible / invalid layers filtered or marked

Optional: `resolveVariablesInDocument(doc, context)` replaces `{{tokens}}` in strings via `pinVariableRegistry` before compose.

---

## 6. Checksum canonicalization

1. Take the configuration object (v1 or v2).  
2. Produce a **canonical JSON** string (sorted object keys, no undefined).  
3. SHA-256 hex digest → `config_checksum`.  

Any content change that affects pixels or variables must change the checksum. Preview cache lookup is `(template_id, config_checksum, format)`.

---

## 7. Out of scope for this document

- Konva editor operations (Module 3)
- Gallery filters / favorites API (Module 4)
- Server render HTTP (Module 6)
- Pin-gen wiring (Module 7)
