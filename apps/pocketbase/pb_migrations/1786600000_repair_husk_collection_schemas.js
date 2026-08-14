/// <reference path="../pb_data/types.d.ts" />
/**
 * Phase 1 — repair id-only husk collections (PB v0.38+).
 *
 * Same class of failure as 1785800000_fix_platform_settings_notification_history_schema:
 * earlier create-only migrations / Admin UI dumps left collections with only `id`,
 * and those migrations are already recorded as applied.
 *
 * This migration is idempotent and production-safe:
 * - never deletes collections
 * - never deletes or rewrites existing records
 * - adds missing fields via fields.add(toField(...))
 * - adds missing indexes with UNIQUE safety gates for legal_* slug indexes,
 *   workspace_onboarding.workspace, and workspace_roles (workspace, slug)
 *   (blank/duplicate husk values)
 * - asserts expected fields exist after save
 *
 * Scope (approved Phase 1 only):
 * legal_pages, legal_page_versions, workspace_onboarding, workspace_audit,
 * workspace_roles, credit_reservations, billing_idempotency,
 * notification_templates, wordpress_api_logs
 *
 * Explicitly excluded: billing_events, content seeds, env/secrets.
 */

const coreNS = typeof core !== "undefined" ? core : {};

function pickCtor(...ctors) {
	for (const ctor of ctors) {
		if (typeof ctor === "function") return ctor;
	}
	return null;
}

function toField(def) {
	if (!def || typeof def !== "object" || typeof def.type !== "string") return def;
	const ctorByType = {
		text: pickCtor(typeof TextField !== "undefined" ? TextField : null, coreNS.TextField),
		number: pickCtor(typeof NumberField !== "undefined" ? NumberField : null, coreNS.NumberField),
		bool: pickCtor(typeof BoolField !== "undefined" ? BoolField : null, coreNS.BoolField),
		select: pickCtor(typeof SelectField !== "undefined" ? SelectField : null, coreNS.SelectField),
		date: pickCtor(typeof DateField !== "undefined" ? DateField : null, coreNS.DateField),
		json: pickCtor(typeof JSONField !== "undefined" ? JSONField : null, coreNS.JSONField),
		relation: pickCtor(typeof RelationField !== "undefined" ? RelationField : null, coreNS.RelationField),
		autodate: pickCtor(typeof AutodateField !== "undefined" ? AutodateField : null, coreNS.AutodateField),
	};
	const Ctor = ctorByType[def.type];
	if (!Ctor) throw new Error("Unsupported migration field type: " + def.type);
	return new Ctor(def);
}

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

function ensureField(collection, def) {
	if (collection.fields.getByName(def.name)) return false;
	collection.fields.add(toField(def));
	return true;
}

function collectionHasIndexMarker(collection, marker) {
	const indexes = Array.isArray(collection?.indexes) ? collection.indexes : [];
	return indexes.some((sql) => String(sql).includes(marker));
}

function ensureIndexSql(collection, indexSql, marker) {
	if (collectionHasIndexMarker(collection, marker)) return false;
	const indexes = Array.isArray(collection.indexes) ? collection.indexes.slice() : [];
	if (indexes.includes(indexSql)) return false;
	indexes.push(indexSql);
	collection.indexes = indexes;
	return true;
}

function ensureApiOnlyRules(collection) {
	let dirty = false;
	for (const key of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) {
		if (collection[key] !== null) {
			collection[key] = null;
			dirty = true;
		}
	}
	return dirty;
}

function assertFields(collection, collectionName, fieldNames) {
	const missing = fieldNames.filter((name) => !collection.fields.getByName(name));
	if (missing.length) {
		throw new Error(collectionName + " still missing fields after save: " + missing.join(", "));
	}
}

function relationField(name, collectionId, options) {
	options = options || {};
	return {
		name: name,
		type: "relation",
		required: options.required === true,
		maxSelect: options.maxSelect != null ? options.maxSelect : 1,
		collectionId: collectionId,
		cascadeDelete: options.cascadeDelete === true,
	};
}

function listRecordsSafe(app, collectionName) {
	try {
		return app.findRecordsByFilter(collectionName, "", "-created", 0, 0) || [];
	} catch (_) {
		try {
			return app.findAllRecords(collectionName) || [];
		} catch (__) {
			return [];
		}
	}
}

function recordFieldString(record, field) {
	try {
		const value = record.get(field);
		if (value == null) return "";
		return String(value).trim();
	} catch (_) {
		return "";
	}
}

/**
 * UNIQUE-index safety gate (Phase 1 audit):
 * Skip UNIQUE when 2+ blank values exist (would collide as "") or when
 * non-blank values duplicate. Multiple true NULLs are fine in SQLite, but
 * PocketBase may materialize blanks as empty strings after field add.
 */
function canAddUniqueIndex(app, collectionName, keyFn) {
	const records = listRecordsSafe(app, collectionName);
	if (!records.length) return true;

	const counts = {};
	let blankCount = 0;
	for (const record of records) {
		const key = keyFn(record);
		if (!key) {
			blankCount += 1;
			continue;
		}
		counts[key] = (counts[key] || 0) + 1;
		if (counts[key] > 1) return false;
	}
	// 2+ blank/empty keys → UNIQUE would fail if stored as ""
	if (blankCount > 1) return false;
	return true;
}

function saveCollection(app, collection) {
	app.save(collection);
	return app.findCollectionByNameOrId(collection.name);
}

const LEGAL_SLUGS = ["privacy", "terms", "cookies", "disclaimer", "refund"];
const AUDIT_ACTIONS = [
	"created",
	"updated",
	"deleted",
	"published",
	"credits_used",
	"billing",
	"role_change",
	"invitation",
	"ownership_transfer",
	"login",
	"other",
];

migrate(
	(app) => {
		const users = findCollectionSafe(app, "users");
		const workspaces = findCollectionSafe(app, "workspaces");
		const wordpressSites = findCollectionSafe(app, "wordpress_sites");

		// --- legal_pages ---
		{
			let collection = findCollectionSafe(app, "legal_pages");
			if (!collection) {
				collection = new Collection({
					type: "base",
					name: "legal_pages",
					listRule: null,
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					fields: [
						{
							type: "select",
							name: "slug",
							required: true,
							maxSelect: 1,
							values: LEGAL_SLUGS,
						},
						{ type: "text", name: "title", required: true, max: 300 },
						{ type: "text", name: "seo_title", max: 300 },
						{ type: "text", name: "meta_description", max: 600 },
						{ type: "text", name: "content", required: true, max: 200000 },
						{
							type: "select",
							name: "status",
							required: true,
							maxSelect: 1,
							values: ["draft", "published"],
						},
						{ type: "number", name: "version", required: true, min: 1 },
						{ type: "text", name: "updated_by", max: 200 },
						{ type: "autodate", name: "created", onCreate: true, onUpdate: false },
						{ type: "autodate", name: "updated", onCreate: true, onUpdate: true },
					].map(toField),
					indexes: [
						"CREATE INDEX `idx_legal_pages_status` ON `legal_pages` (`status`)",
					],
				});
				collection = saveCollection(app, collection);
			} else {
				let dirty = ensureApiOnlyRules(collection);
				dirty = ensureField(collection, {
					type: "select",
					name: "slug",
					required: true,
					maxSelect: 1,
					values: LEGAL_SLUGS,
				}) || dirty;
				dirty = ensureField(collection, { type: "text", name: "title", required: true, max: 300 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "seo_title", max: 300 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "meta_description", max: 600 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "content", required: true, max: 200000 }) || dirty;
				dirty = ensureField(collection, {
					type: "select",
					name: "status",
					required: true,
					maxSelect: 1,
					values: ["draft", "published"],
				}) || dirty;
				dirty = ensureField(collection, { type: "number", name: "version", required: true, min: 1 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "updated_by", max: 200 }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "created", onCreate: true, onUpdate: false }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "updated", onCreate: true, onUpdate: true }) || dirty;
				dirty = ensureIndexSql(
					collection,
					"CREATE INDEX `idx_legal_pages_status` ON `legal_pages` (`status`)",
					"idx_legal_pages_status",
				) || dirty;

				// UNIQUE slug — gated (do not alter husk records in Phase 1)
				if (
					canAddUniqueIndex(app, "legal_pages", (record) => recordFieldString(record, "slug"))
				) {
					dirty = ensureIndexSql(
						collection,
						"CREATE UNIQUE INDEX `idx_legal_pages_slug` ON `legal_pages` (`slug`)",
						"idx_legal_pages_slug",
					) || dirty;
				}

				if (dirty) collection = saveCollection(app, collection);
			}
			assertFields(collection, "legal_pages", [
				"slug", "title", "seo_title", "meta_description", "content",
				"status", "version", "updated_by", "created", "updated",
			]);
		}

		const legalPages = findCollectionSafe(app, "legal_pages");

		// --- legal_page_versions ---
		{
			let collection = findCollectionSafe(app, "legal_page_versions");
			if (!collection) {
				if (!legalPages) throw new Error("legal_pages required before legal_page_versions");
				collection = new Collection({
					type: "base",
					name: "legal_page_versions",
					listRule: null,
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					fields: [
						relationField("page", legalPages.id, { required: true, cascadeDelete: true }),
						{
							type: "select",
							name: "slug",
							required: true,
							maxSelect: 1,
							values: LEGAL_SLUGS,
						},
						{ type: "number", name: "version", required: true, min: 1 },
						{ type: "text", name: "title", required: true, max: 300 },
						{ type: "text", name: "seo_title", max: 300 },
						{ type: "text", name: "meta_description", max: 600 },
						{ type: "text", name: "content", required: true, max: 200000 },
						{
							type: "select",
							name: "status",
							required: true,
							maxSelect: 1,
							values: ["draft", "published"],
						},
						{ type: "text", name: "updated_by", max: 200 },
						{ type: "date", name: "snapshot_at" },
						{ type: "autodate", name: "created", onCreate: true, onUpdate: false },
						{ type: "autodate", name: "updated", onCreate: true, onUpdate: true },
					].map(toField),
					indexes: [
						"CREATE INDEX `idx_legal_page_versions_page` ON `legal_page_versions` (`page`)",
					],
				});
				collection = saveCollection(app, collection);
			} else {
				let dirty = ensureApiOnlyRules(collection);
				if (legalPages) {
					dirty = ensureField(collection, relationField("page", legalPages.id, {
						required: true,
						cascadeDelete: true,
					})) || dirty;
				}
				dirty = ensureField(collection, {
					type: "select",
					name: "slug",
					required: true,
					maxSelect: 1,
					values: LEGAL_SLUGS,
				}) || dirty;
				dirty = ensureField(collection, { type: "number", name: "version", required: true, min: 1 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "title", required: true, max: 300 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "seo_title", max: 300 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "meta_description", max: 600 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "content", required: true, max: 200000 }) || dirty;
				dirty = ensureField(collection, {
					type: "select",
					name: "status",
					required: true,
					maxSelect: 1,
					values: ["draft", "published"],
				}) || dirty;
				dirty = ensureField(collection, { type: "text", name: "updated_by", max: 200 }) || dirty;
				dirty = ensureField(collection, { type: "date", name: "snapshot_at" }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "created", onCreate: true, onUpdate: false }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "updated", onCreate: true, onUpdate: true }) || dirty;
				dirty = ensureIndexSql(
					collection,
					"CREATE INDEX `idx_legal_page_versions_page` ON `legal_page_versions` (`page`)",
					"idx_legal_page_versions_page",
				) || dirty;

				if (
					canAddUniqueIndex(app, "legal_page_versions", (record) => {
						const slug = recordFieldString(record, "slug");
						const version = recordFieldString(record, "version");
						if (!slug && !version) return "";
						return slug + "::" + version;
					})
				) {
					dirty = ensureIndexSql(
						collection,
						"CREATE UNIQUE INDEX `idx_legal_page_versions_slug_ver` ON `legal_page_versions` (`slug`, `version`)",
						"idx_legal_page_versions_slug_ver",
					) || dirty;
				}

				if (dirty) collection = saveCollection(app, collection);
			}
			assertFields(collection, "legal_page_versions", [
				"page", "slug", "version", "title", "seo_title", "meta_description",
				"content", "status", "updated_by", "snapshot_at", "created", "updated",
			]);
		}

		// --- workspace_onboarding ---
		{
			let collection = findCollectionSafe(app, "workspace_onboarding");
			if (!collection) {
				if (!workspaces || !users) {
					// Skip create if prerequisites missing; next boot / ensure can create.
				} else {
					collection = new Collection({
						type: "base",
						name: "workspace_onboarding",
						listRule: null,
						viewRule: null,
						createRule: null,
						updateRule: null,
						deleteRule: null,
						fields: [
							relationField("workspace", workspaces.id, { required: true, cascadeDelete: true }),
							{ type: "json", name: "steps" },
							{ type: "number", name: "completed_percent" },
							{ type: "bool", name: "skipped" },
							{ type: "date", name: "completed_at" },
							relationField("updated_by", users.id),
							{ type: "autodate", name: "created", onCreate: true, onUpdate: false },
							{ type: "autodate", name: "updated", onCreate: true, onUpdate: true },
						].map(toField),
						indexes: [
							"CREATE UNIQUE INDEX `idx_workspace_onboarding_ws` ON `workspace_onboarding` (`workspace`)",
						],
					});
					collection = saveCollection(app, collection);
				}
			} else {
				let dirty = ensureApiOnlyRules(collection);
				if (workspaces) {
					dirty = ensureField(collection, relationField("workspace", workspaces.id, {
						required: true,
						cascadeDelete: true,
					})) || dirty;
				}
				dirty = ensureField(collection, { type: "json", name: "steps" }) || dirty;
				dirty = ensureField(collection, { type: "number", name: "completed_percent" }) || dirty;
				dirty = ensureField(collection, { type: "bool", name: "skipped" }) || dirty;
				dirty = ensureField(collection, { type: "date", name: "completed_at" }) || dirty;
				if (users) {
					dirty = ensureField(collection, relationField("updated_by", users.id)) || dirty;
				}
				dirty = ensureField(collection, { type: "autodate", name: "created", onCreate: true, onUpdate: false }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "updated", onCreate: true, onUpdate: true }) || dirty;
				// UNIQUE(workspace) — gated (do not alter husk records in Phase 1)
				if (
					canAddUniqueIndex(app, "workspace_onboarding", (record) =>
						recordFieldString(record, "workspace"))
				) {
					dirty = ensureIndexSql(
						collection,
						"CREATE UNIQUE INDEX `idx_workspace_onboarding_ws` ON `workspace_onboarding` (`workspace`)",
						"idx_workspace_onboarding_ws",
					) || dirty;
				}
				if (dirty) collection = saveCollection(app, collection);
			}
			if (collection) {
				assertFields(collection, "workspace_onboarding", [
					"workspace", "steps", "completed_percent", "skipped",
					"completed_at", "updated_by", "created", "updated",
				]);
			}
		}

		// --- workspace_audit ---
		{
			let collection = findCollectionSafe(app, "workspace_audit");
			if (!collection) {
				if (workspaces && users) {
					collection = new Collection({
						type: "base",
						name: "workspace_audit",
						listRule: null,
						viewRule: null,
						createRule: null,
						updateRule: null,
						deleteRule: null,
						fields: [
							relationField("workspace", workspaces.id, { required: true, cascadeDelete: true }),
							relationField("actor", users.id),
							{
								type: "select",
								name: "action",
								maxSelect: 1,
								values: AUDIT_ACTIONS,
							},
							{ type: "text", name: "resource_type", max: 80 },
							{ type: "text", name: "resource_id", max: 64 },
							{ type: "text", name: "title", max: 300 },
							{ type: "text", name: "summary", max: 1000 },
							{ type: "json", name: "meta" },
							{ type: "autodate", name: "created", onCreate: true, onUpdate: false },
						].map(toField),
						indexes: [
							"CREATE INDEX `idx_workspace_audit_ws_created` ON `workspace_audit` (`workspace`, `created`)",
							"CREATE INDEX `idx_workspace_audit_action` ON `workspace_audit` (`workspace`, `action`)",
						],
					});
					collection = saveCollection(app, collection);
				}
			} else {
				let dirty = ensureApiOnlyRules(collection);
				if (workspaces) {
					dirty = ensureField(collection, relationField("workspace", workspaces.id, {
						required: true,
						cascadeDelete: true,
					})) || dirty;
				}
				if (users) {
					dirty = ensureField(collection, relationField("actor", users.id)) || dirty;
				}
				dirty = ensureField(collection, {
					type: "select",
					name: "action",
					maxSelect: 1,
					values: AUDIT_ACTIONS,
				}) || dirty;
				dirty = ensureField(collection, { type: "text", name: "resource_type", max: 80 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "resource_id", max: 64 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "title", max: 300 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "summary", max: 1000 }) || dirty;
				dirty = ensureField(collection, { type: "json", name: "meta" }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "created", onCreate: true, onUpdate: false }) || dirty;
				dirty = ensureIndexSql(
					collection,
					"CREATE INDEX `idx_workspace_audit_ws_created` ON `workspace_audit` (`workspace`, `created`)",
					"idx_workspace_audit_ws_created",
				) || dirty;
				dirty = ensureIndexSql(
					collection,
					"CREATE INDEX `idx_workspace_audit_action` ON `workspace_audit` (`workspace`, `action`)",
					"idx_workspace_audit_action",
				) || dirty;
				if (dirty) collection = saveCollection(app, collection);
			}
			if (collection) {
				assertFields(collection, "workspace_audit", [
					"workspace", "actor", "action", "resource_type", "resource_id",
					"title", "summary", "meta", "created",
				]);
			}
		}

		// --- workspace_roles ---
		{
			let collection = findCollectionSafe(app, "workspace_roles");
			if (!collection) {
				if (workspaces) {
					collection = new Collection({
						type: "base",
						name: "workspace_roles",
						listRule: null,
						viewRule: null,
						createRule: null,
						updateRule: null,
						deleteRule: null,
						fields: [
							relationField("workspace", workspaces.id, { required: true, cascadeDelete: true }),
							{ type: "text", name: "name", required: true, max: 80 },
							{ type: "text", name: "slug", required: true, max: 64 },
							{ type: "text", name: "description", max: 500 },
							{ type: "json", name: "permissions" },
							{ type: "bool", name: "is_system" },
							{ type: "bool", name: "active" },
							users
								? relationField("created_by", users.id)
								: { type: "text", name: "created_by", max: 64 },
							{ type: "autodate", name: "created", onCreate: true, onUpdate: false },
							{ type: "autodate", name: "updated", onCreate: true, onUpdate: true },
						].map(toField),
						indexes: [
							"CREATE UNIQUE INDEX `idx_workspace_roles_slug` ON `workspace_roles` (`workspace`, `slug`)",
						],
					});
					collection = saveCollection(app, collection);
				}
			} else {
				let dirty = ensureApiOnlyRules(collection);
				if (workspaces) {
					dirty = ensureField(collection, relationField("workspace", workspaces.id, {
						required: true,
						cascadeDelete: true,
					})) || dirty;
				}
				dirty = ensureField(collection, { type: "text", name: "name", required: true, max: 80 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "slug", required: true, max: 64 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "description", max: 500 }) || dirty;
				dirty = ensureField(collection, { type: "json", name: "permissions" }) || dirty;
				dirty = ensureField(collection, { type: "bool", name: "is_system" }) || dirty;
				dirty = ensureField(collection, { type: "bool", name: "active" }) || dirty;
				if (users) {
					dirty = ensureField(collection, relationField("created_by", users.id)) || dirty;
				} else {
					dirty = ensureField(collection, { type: "text", name: "created_by", max: 64 }) || dirty;
				}
				dirty = ensureField(collection, { type: "autodate", name: "created", onCreate: true, onUpdate: false }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "updated", onCreate: true, onUpdate: true }) || dirty;
				// UNIQUE (workspace, slug) — gated (do not alter husk records in Phase 1)
				if (
					canAddUniqueIndex(app, "workspace_roles", (record) => {
						const workspace = recordFieldString(record, "workspace");
						const slug = recordFieldString(record, "slug");
						if (!workspace && !slug) return "";
						return workspace + "::" + slug;
					})
				) {
					dirty = ensureIndexSql(
						collection,
						"CREATE UNIQUE INDEX `idx_workspace_roles_slug` ON `workspace_roles` (`workspace`, `slug`)",
						"idx_workspace_roles_slug",
					) || dirty;
				}
				if (dirty) collection = saveCollection(app, collection);
			}
			if (collection) {
				assertFields(collection, "workspace_roles", [
					"workspace", "name", "slug", "description", "permissions",
					"is_system", "active", "created_by", "created", "updated",
				]);
			}
		}

		// --- credit_reservations ---
		{
			let collection = findCollectionSafe(app, "credit_reservations");
			if (!collection) {
				collection = new Collection({
					type: "base",
					name: "credit_reservations",
					listRule: null,
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					fields: [
						{ type: "text", name: "workspace_key", required: true, max: 120 },
						{ type: "text", name: "workspace_name", max: 200 },
						{ type: "number", name: "amount", required: true, min: 0 },
						{ type: "text", name: "feature", max: 80 },
						{
							type: "select",
							name: "status",
							required: true,
							maxSelect: 1,
							values: ["reserved", "committed", "released", "expired"],
						},
						{ type: "text", name: "reason", max: 500 },
						{ type: "text", name: "reference_id", max: 120 },
						{ type: "text", name: "idempotency_key", max: 120 },
						{ type: "date", name: "expires_at" },
						{ type: "json", name: "metadata" },
						{ type: "text", name: "created_by_user", max: 64 },
						{ type: "autodate", name: "created", onCreate: true, onUpdate: false },
						{ type: "autodate", name: "updated", onCreate: true, onUpdate: true },
					].map(toField),
					indexes: [
						"CREATE INDEX `idx_credit_reservations_ws` ON `credit_reservations` (`workspace_key`, `status`)",
						"CREATE UNIQUE INDEX `idx_credit_reservations_idem` ON `credit_reservations` (`idempotency_key`)",
					],
				});
				collection = saveCollection(app, collection);
			} else {
				let dirty = ensureApiOnlyRules(collection);
				dirty = ensureField(collection, { type: "text", name: "workspace_key", required: true, max: 120 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "workspace_name", max: 200 }) || dirty;
				dirty = ensureField(collection, { type: "number", name: "amount", required: true, min: 0 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "feature", max: 80 }) || dirty;
				dirty = ensureField(collection, {
					type: "select",
					name: "status",
					required: true,
					maxSelect: 1,
					values: ["reserved", "committed", "released", "expired"],
				}) || dirty;
				dirty = ensureField(collection, { type: "text", name: "reason", max: 500 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "reference_id", max: 120 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "idempotency_key", max: 120 }) || dirty;
				dirty = ensureField(collection, { type: "date", name: "expires_at" }) || dirty;
				dirty = ensureField(collection, { type: "json", name: "metadata" }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "created_by_user", max: 64 }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "created", onCreate: true, onUpdate: false }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "updated", onCreate: true, onUpdate: true }) || dirty;
				dirty = ensureIndexSql(
					collection,
					"CREATE INDEX `idx_credit_reservations_ws` ON `credit_reservations` (`workspace_key`, `status`)",
					"idx_credit_reservations_ws",
				) || dirty;
				if (
					canAddUniqueIndex(app, "credit_reservations", (record) =>
						recordFieldString(record, "idempotency_key"))
				) {
					dirty = ensureIndexSql(
						collection,
						"CREATE UNIQUE INDEX `idx_credit_reservations_idem` ON `credit_reservations` (`idempotency_key`)",
						"idx_credit_reservations_idem",
					) || dirty;
				}
				if (dirty) collection = saveCollection(app, collection);
			}
			assertFields(collection, "credit_reservations", [
				"workspace_key", "workspace_name", "amount", "feature", "status",
				"reason", "reference_id", "idempotency_key", "expires_at", "metadata",
				"created_by_user", "created", "updated",
			]);
		}

		// --- billing_idempotency ---
		{
			let collection = findCollectionSafe(app, "billing_idempotency");
			if (!collection) {
				collection = new Collection({
					type: "base",
					name: "billing_idempotency",
					listRule: null,
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					fields: [
						{ type: "text", name: "idempotency_key", required: true, max: 180 },
						{ type: "text", name: "scope", max: 40 },
						{ type: "text", name: "workspace_key", max: 120 },
						{ type: "text", name: "provider", max: 40 },
						{ type: "text", name: "event_type", max: 120 },
						{
							type: "select",
							name: "status",
							required: true,
							maxSelect: 1,
							values: ["processing", "completed", "failed"],
						},
						{ type: "json", name: "payload" },
						{ type: "json", name: "result" },
						{ type: "date", name: "processed_at" },
						{ type: "autodate", name: "created", onCreate: true, onUpdate: false },
						{ type: "autodate", name: "updated", onCreate: true, onUpdate: true },
					].map(toField),
					indexes: [
						"CREATE UNIQUE INDEX `idx_billing_idempotency_key` ON `billing_idempotency` (`idempotency_key`)",
						"CREATE INDEX `idx_billing_idempotency_ws` ON `billing_idempotency` (`workspace_key`, `created`)",
					],
				});
				collection = saveCollection(app, collection);
			} else {
				let dirty = ensureApiOnlyRules(collection);
				dirty = ensureField(collection, { type: "text", name: "idempotency_key", required: true, max: 180 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "scope", max: 40 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "workspace_key", max: 120 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "provider", max: 40 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "event_type", max: 120 }) || dirty;
				dirty = ensureField(collection, {
					type: "select",
					name: "status",
					required: true,
					maxSelect: 1,
					values: ["processing", "completed", "failed"],
				}) || dirty;
				dirty = ensureField(collection, { type: "json", name: "payload" }) || dirty;
				dirty = ensureField(collection, { type: "json", name: "result" }) || dirty;
				dirty = ensureField(collection, { type: "date", name: "processed_at" }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "created", onCreate: true, onUpdate: false }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "updated", onCreate: true, onUpdate: true }) || dirty;
				if (
					canAddUniqueIndex(app, "billing_idempotency", (record) =>
						recordFieldString(record, "idempotency_key"))
				) {
					dirty = ensureIndexSql(
						collection,
						"CREATE UNIQUE INDEX `idx_billing_idempotency_key` ON `billing_idempotency` (`idempotency_key`)",
						"idx_billing_idempotency_key",
					) || dirty;
				}
				dirty = ensureIndexSql(
					collection,
					"CREATE INDEX `idx_billing_idempotency_ws` ON `billing_idempotency` (`workspace_key`, `created`)",
					"idx_billing_idempotency_ws",
				) || dirty;
				if (dirty) collection = saveCollection(app, collection);
			}
			assertFields(collection, "billing_idempotency", [
				"idempotency_key", "scope", "workspace_key", "provider", "event_type",
				"status", "payload", "result", "processed_at", "created", "updated",
			]);
		}

		// --- notification_templates ---
		{
			let collection = findCollectionSafe(app, "notification_templates");
			if (!collection) {
				collection = new Collection({
					type: "base",
					name: "notification_templates",
					listRule: null,
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					fields: [
						{ type: "text", name: "title", required: true, max: 300 },
						{ type: "text", name: "body", max: 4000 },
						{
							type: "select",
							name: "channel",
							required: true,
							maxSelect: 1,
							values: ["email", "in-app", "in_app"],
						},
						{
							type: "select",
							name: "status",
							required: true,
							maxSelect: 1,
							values: ["draft", "scheduled", "active"],
						},
						{ type: "date", name: "scheduled_at" },
						{ type: "json", name: "meta", maxSize: 100000 },
						{ type: "autodate", name: "created", onCreate: true, onUpdate: false },
						{ type: "autodate", name: "updated", onCreate: true, onUpdate: true },
					].map(toField),
					indexes: [
						"CREATE INDEX `idx_notification_templates_status` ON `notification_templates` (`status`)",
						"CREATE INDEX `idx_notification_templates_channel` ON `notification_templates` (`channel`)",
					],
				});
				collection = saveCollection(app, collection);
			} else {
				let dirty = ensureApiOnlyRules(collection);
				dirty = ensureField(collection, { type: "text", name: "title", required: true, max: 300 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "body", max: 4000 }) || dirty;
				dirty = ensureField(collection, {
					type: "select",
					name: "channel",
					required: true,
					maxSelect: 1,
					values: ["email", "in-app", "in_app"],
				}) || dirty;
				dirty = ensureField(collection, {
					type: "select",
					name: "status",
					required: true,
					maxSelect: 1,
					values: ["draft", "scheduled", "active"],
				}) || dirty;
				dirty = ensureField(collection, { type: "date", name: "scheduled_at" }) || dirty;
				dirty = ensureField(collection, { type: "json", name: "meta", maxSize: 100000 }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "created", onCreate: true, onUpdate: false }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "updated", onCreate: true, onUpdate: true }) || dirty;
				dirty = ensureIndexSql(
					collection,
					"CREATE INDEX `idx_notification_templates_status` ON `notification_templates` (`status`)",
					"idx_notification_templates_status",
				) || dirty;
				dirty = ensureIndexSql(
					collection,
					"CREATE INDEX `idx_notification_templates_channel` ON `notification_templates` (`channel`)",
					"idx_notification_templates_channel",
				) || dirty;
				if (dirty) collection = saveCollection(app, collection);
			}
			assertFields(collection, "notification_templates", [
				"title", "body", "channel", "status", "scheduled_at", "meta", "created", "updated",
			]);
		}

		// --- wordpress_api_logs ---
		{
			let collection = findCollectionSafe(app, "wordpress_api_logs");
			if (!collection) {
				const fields = [];
				if (users) fields.push(relationField("owner", users.id, { cascadeDelete: true }));
				else fields.push({ type: "text", name: "owner", max: 80 });
				fields.push({ type: "text", name: "workspace_key", max: 120 });
				if (wordpressSites) {
					fields.push(relationField("site", wordpressSites.id, { cascadeDelete: true }));
				}
				fields.push(
					{ type: "text", name: "site_id", max: 80 },
					{ type: "text", name: "job_id", max: 80 },
					{ type: "text", name: "method", max: 20 },
					{ type: "text", name: "path", max: 1000 },
					{ type: "number", name: "status_code", min: 0 },
					{ type: "number", name: "duration_ms", min: 0 },
					{ type: "bool", name: "ok" },
					{ type: "text", name: "error", max: 4000 },
					{ type: "json", name: "request_meta", maxSize: 100000 },
					{ type: "json", name: "response_meta", maxSize: 200000 },
					{ type: "autodate", name: "created", onCreate: true, onUpdate: false },
					{ type: "autodate", name: "updated", onCreate: true, onUpdate: true },
				);
				collection = new Collection({
					type: "base",
					name: "wordpress_api_logs",
					listRule: null,
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					fields: fields.map(toField),
					indexes: [
						"CREATE INDEX `idx_wordpress_api_logs_owner` ON `wordpress_api_logs` (`owner`)",
						"CREATE INDEX `idx_wordpress_api_logs_site` ON `wordpress_api_logs` (`site_id`)",
						"CREATE INDEX `idx_wordpress_api_logs_created` ON `wordpress_api_logs` (`created`)",
					],
				});
				collection = saveCollection(app, collection);
			} else {
				let dirty = ensureApiOnlyRules(collection);
				if (users) {
					dirty = ensureField(collection, relationField("owner", users.id, { cascadeDelete: true })) || dirty;
				} else {
					dirty = ensureField(collection, { type: "text", name: "owner", max: 80 }) || dirty;
				}
				dirty = ensureField(collection, { type: "text", name: "workspace_key", max: 120 }) || dirty;
				if (wordpressSites) {
					dirty = ensureField(collection, relationField("site", wordpressSites.id, {
						cascadeDelete: true,
					})) || dirty;
				}
				dirty = ensureField(collection, { type: "text", name: "site_id", max: 80 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "job_id", max: 80 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "method", max: 20 }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "path", max: 1000 }) || dirty;
				dirty = ensureField(collection, { type: "number", name: "status_code", min: 0 }) || dirty;
				dirty = ensureField(collection, { type: "number", name: "duration_ms", min: 0 }) || dirty;
				dirty = ensureField(collection, { type: "bool", name: "ok" }) || dirty;
				dirty = ensureField(collection, { type: "text", name: "error", max: 4000 }) || dirty;
				dirty = ensureField(collection, { type: "json", name: "request_meta", maxSize: 100000 }) || dirty;
				dirty = ensureField(collection, { type: "json", name: "response_meta", maxSize: 200000 }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "created", onCreate: true, onUpdate: false }) || dirty;
				dirty = ensureField(collection, { type: "autodate", name: "updated", onCreate: true, onUpdate: true }) || dirty;
				dirty = ensureIndexSql(
					collection,
					"CREATE INDEX `idx_wordpress_api_logs_owner` ON `wordpress_api_logs` (`owner`)",
					"idx_wordpress_api_logs_owner",
				) || dirty;
				dirty = ensureIndexSql(
					collection,
					"CREATE INDEX `idx_wordpress_api_logs_site` ON `wordpress_api_logs` (`site_id`)",
					"idx_wordpress_api_logs_site",
				) || dirty;
				dirty = ensureIndexSql(
					collection,
					"CREATE INDEX `idx_wordpress_api_logs_created` ON `wordpress_api_logs` (`created`)",
					"idx_wordpress_api_logs_created",
				) || dirty;
				if (dirty) collection = saveCollection(app, collection);
			}
			const expected = [
				"owner", "workspace_key", "site_id", "job_id", "method", "path",
				"status_code", "duration_ms", "ok", "error", "request_meta",
				"response_meta", "created", "updated",
			];
			if (wordpressSites) expected.splice(2, 0, "site");
			assertFields(collection, "wordpress_api_logs", expected);
		}
	},
	(app) => {
		// Additive repair — no destructive down.
	},
);
