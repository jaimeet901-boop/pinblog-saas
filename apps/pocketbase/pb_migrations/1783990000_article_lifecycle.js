/// <reference path="../pb_data/types.d.ts" />
/**
 * Article Lifecycle (Chef IA Phase 13):
 * - lifecycle fields on website_articles (additive; keeps legacy status)
 * - article_activity_history for every transition
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
	if (!Ctor) throw new Error(`Unsupported migration field type: ${def.type}`);
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
	if (!collection.fields.getByName(def.name)) {
		collection.fields.add(toField(def));
		return true;
	}
	return false;
}

function ensureIndex(collection, sql) {
	const indexes = Array.isArray(collection.indexes) ? collection.indexes.slice() : [];
	if (indexes.includes(sql)) return false;
	indexes.push(sql);
	collection.indexes = indexes;
	return true;
}

function relationField(name, collectionId, options = {}) {
	return {
		name,
		type: "relation",
		required: options.required === true,
		maxSelect: options.maxSelect ?? 1,
		collectionId,
		cascadeDelete: options.cascadeDelete === true,
	};
}

const LIFECYCLE_STATES = [
	"DISCOVERED",
	"SYNCED",
	"READY_FOR_AI",
	"AI_GENERATING",
	"AI_COMPLETED",
	"READY_FOR_PINS",
	"PINS_GENERATING",
	"PINS_READY",
	"READY_FOR_PUBLISH",
	"SCHEDULED",
	"PUBLISHED",
	"FAILED",
	"ARCHIVED",
];

migrate(
	(app) => {
		const articles = findCollectionSafe(app, "website_articles");
		if (articles) {
			let dirty = false;
			dirty = ensureField(articles, {
				type: "select",
				name: "lifecycle_state",
				maxSelect: 1,
				values: LIFECYCLE_STATES,
			}) || dirty;
			dirty = ensureField(articles, {
				type: "select",
				name: "lifecycle_previous_state",
				maxSelect: 1,
				values: LIFECYCLE_STATES,
			}) || dirty;
			dirty = ensureField(articles, { type: "date", name: "lifecycle_changed_at" }) || dirty;
			dirty = ensureField(articles, { type: "text", name: "lifecycle_failure_reason", max: 4000 }) || dirty;
			dirty = ensureField(articles, { type: "number", name: "lifecycle_retry_count", min: 0 }) || dirty;
			dirty = ensureField(articles, { type: "number", name: "lifecycle_processing_ms", min: 0 }) || dirty;
			dirty = ensureField(articles, { type: "date", name: "ai_started_at" }) || dirty;
			dirty = ensureField(articles, { type: "date", name: "ai_completed_at" }) || dirty;
			dirty = ensureField(articles, { type: "date", name: "pins_started_at" }) || dirty;
			dirty = ensureField(articles, { type: "date", name: "pins_ready_at" }) || dirty;
			dirty = ensureField(articles, { type: "date", name: "publish_started_at" }) || dirty;
			dirty = ensureField(articles, { type: "date", name: "published_at" }) || dirty;
			dirty = ensureField(articles, { type: "text", name: "lifecycle_failed_stage", max: 64 }) || dirty;
			dirty = ensureIndex(
				articles,
				"CREATE INDEX `idx_website_articles_lifecycle` ON `website_articles` (`websiteId`, `lifecycle_state`)",
			) || dirty;
			if (dirty) app.save(articles);
		}

		if (!findCollectionSafe(app, "article_activity_history")) {
			const users = findCollectionSafe(app, "users");
			const websites = findCollectionSafe(app, "websites");
			const websiteArticles = findCollectionSafe(app, "website_articles");
			const fields = [];
			if (users) fields.push(relationField("owner", users.id, { required: true, cascadeDelete: true }));
			else fields.push({ type: "text", name: "owner", max: 80, required: true });
			if (websiteArticles) fields.push(relationField("article", websiteArticles.id, { required: true, cascadeDelete: true }));
			else fields.push({ type: "text", name: "article_id", max: 80, required: true });
			if (websites) fields.push(relationField("website", websites.id, { cascadeDelete: false }));
			else fields.push({ type: "text", name: "website_id", max: 80 });

			fields.push(
				{ type: "text", name: "event", required: true, max: 80 },
				{
					type: "select",
					name: "from_state",
					maxSelect: 1,
					values: LIFECYCLE_STATES,
				},
				{
					type: "select",
					name: "to_state",
					maxSelect: 1,
					values: LIFECYCLE_STATES,
				},
				{ type: "text", name: "message", max: 2000 },
				{ type: "text", name: "source", max: 80 },
				{ type: "json", name: "meta", maxSize: 200000 },
				{ type: "date", name: "occurred_at" },
				{ type: "autodate", name: "created", onCreate: true, onUpdate: false },
				{ type: "autodate", name: "updated", onCreate: true, onUpdate: true },
			);

			const collection = new Collection({
				type: "base",
				name: "article_activity_history",
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
				indexes: [
					"CREATE INDEX `idx_article_activity_article` ON `article_activity_history` (`article`, `occurred_at`)",
					"CREATE INDEX `idx_article_activity_owner` ON `article_activity_history` (`owner`, `occurred_at`)",
					"CREATE INDEX `idx_article_activity_event` ON `article_activity_history` (`event`)",
				],
				fields,
			});
			app.save(collection);
		}
	},
	(app) => {
		const history = findCollectionSafe(app, "article_activity_history");
		if (history) app.delete(history);
	},
);
