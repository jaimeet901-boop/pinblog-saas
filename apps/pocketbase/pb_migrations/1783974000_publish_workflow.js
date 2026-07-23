/// <reference path="../pb_data/types.d.ts" />
/**
 * Publish workflow: waiting_provider job status for Pinterest Trial Access.
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
		select: pickCtor(typeof SelectField !== "undefined" ? SelectField : null, coreNS.SelectField),
		json: pickCtor(typeof JSONField !== "undefined" ? JSONField : null, coreNS.JSONField),
		bool: pickCtor(typeof BoolField !== "undefined" ? BoolField : null, coreNS.BoolField),
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

function ensureSelectValues(collection, fieldName, extraValues) {
	const field = collection.fields.getByName(fieldName);
	if (!field || !Array.isArray(field.values)) return false;
	let changed = false;
	for (const value of extraValues) {
		if (!field.values.includes(value)) {
			field.values.push(value);
			changed = true;
		}
	}
	return changed;
}

function ensureField(collection, def) {
	if (!collection.fields.getByName(def.name)) {
		collection.fields.add(toField(def));
		return true;
	}
	return false;
}

migrate(
	(app) => {
		const pinJobs = findCollectionSafe(app, "pinterest_publish_jobs");
		if (pinJobs) {
			let dirty = ensureSelectValues(pinJobs, "status", ["waiting_provider", "retrying"]);
			dirty = ensureField(pinJobs, { type: "text", name: "workflow_id", max: 80 }) || dirty;
			dirty = ensureField(pinJobs, { type: "text", name: "source_publish_job", max: 80 }) || dirty;
			dirty = ensureField(pinJobs, { type: "text", name: "destination_url", max: 1000 }) || dirty;
			if (dirty) app.save(pinJobs);
		}

		const queueJobs = findCollectionSafe(app, "queue_jobs");
		if (queueJobs) {
			if (ensureSelectValues(queueJobs, "status", ["waiting_provider"])) {
				app.save(queueJobs);
			}
		}

		const publishJobs = findCollectionSafe(app, "publish_jobs");
		if (publishJobs) {
			let dirty = false;
			dirty = ensureField(publishJobs, { type: "text", name: "workflow_id", max: 80 }) || dirty;
			dirty = ensureField(publishJobs, { type: "bool", name: "enqueue_pinterest" }) || dirty;
			dirty = ensureField(publishJobs, { type: "text", name: "pinterest_job_id", max: 80 }) || dirty;
			if (dirty) app.save(publishJobs);
		}
	},
	(_app) => {
		// non-destructive
	},
);
