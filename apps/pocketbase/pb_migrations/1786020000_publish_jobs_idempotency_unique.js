/// <reference path="../pb_data/types.d.ts" />
/**
 * P1-13 — Enforce unique WordPress publish enqueue idempotency per owner.
 *
 * Adds UNIQUE INDEX on publish_jobs(owner, idempotency_key).
 * Existing duplicate (owner, idempotency_key) rows are preserved; losers are re-keyed
 * with deterministic repair keys so the unique index can be applied safely.
 */

const PUBLISH_JOBS_OWNER_IDEMPOTENCY_INDEX_SQL =
	"CREATE UNIQUE INDEX `idx_publish_jobs_owner_idempotency` ON `publish_jobs` (`owner`, `idempotency_key`)";
const PUBLISH_JOBS_OWNER_IDEMPOTENCY_INDEX_MARKER = "idx_publish_jobs_owner_idempotency";
const PUBLISH_JOBS_IDEMPOTENCY_INDEX_MARKER = "idx_publish_jobs_idempotency";
const PUBLISH_JOBS_IDEMPOTENCY_INDEX_SQL =
	"CREATE INDEX `idx_publish_jobs_idempotency` ON `publish_jobs` (`idempotency_key`)";

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

function collectionHasIndexMarker(collection, marker) {
	const indexes = Array.isArray(collection?.indexes) ? collection.indexes : [];
	return indexes.some((sql) => String(sql).includes(marker));
}

function ensureIndex(collection, sql) {
	const indexes = Array.isArray(collection.indexes) ? collection.indexes.slice() : [];
	if (indexes.includes(sql)) return false;
	indexes.push(sql);
	collection.indexes = indexes;
	return true;
}

function recordString(record, field) {
	try {
		const v = record.get(field);
		if (v == null) return "";
		return String(v).trim();
	} catch (_) {
		return "";
	}
}

function recordTimestampMs(record) {
	try {
		const updated = record.get("updated");
		const created = record.get("created");
		const t = Date.parse(String(updated || created || ""));
		return Number.isFinite(t) ? t : 0;
	} catch (_) {
		return 0;
	}
}

function findAllRecordsSafe(app, collectionName) {
	try {
		return app.findRecordsByFilter(collectionName, "", "-created,-updated", 0, 0) || [];
	} catch (_) {
		try {
			return app.findAllRecords(collectionName) || [];
		} catch {
			return [];
		}
	}
}

function repairPublishJobIdempotencyKey(recordId) {
	const id = String(recordId || "").trim() || "unknown";
	return `wp-dedupe-${id}`.slice(0, 120);
}

/**
 * For each duplicated (owner, idempotency_key): keep the earliest record; re-key the rest.
 */
function dedupePublishJobOwnerIdempotencyKeys(app, jobsCollection) {
	if (!jobsCollection || !jobsCollection.fields.getByName("idempotency_key")) {
		return { changed: 0, duplicatesFixed: 0 };
	}

	const collectionName = jobsCollection.name || "publish_jobs";
	const records = findAllRecordsSafe(app, collectionName);
	if (!Array.isArray(records) || !records.length) {
		return { changed: 0, duplicatesFixed: 0 };
	}

	const groups = {};
	for (const record of records) {
		const owner = recordString(record, "owner");
		const key = recordString(record, "idempotency_key");
		const groupKey = `${owner}\0${key}`;
		if (!groups[groupKey]) groups[groupKey] = [];
		groups[groupKey].push(record);
	}

	const dirtyRecords = [];
	let duplicatesFixed = 0;
	const usedKeys = new Set();

	for (const record of records) {
		const owner = recordString(record, "owner");
		const key = recordString(record, "idempotency_key");
		usedKeys.add(`${owner}\0${key}`);
	}

	for (const groupKey of Object.keys(groups)) {
		const group = groups[groupKey];
		if (!Array.isArray(group) || group.length < 2) continue;

		group.sort((a, b) => {
			const ta = recordTimestampMs(a);
			const tb = recordTimestampMs(b);
			if (ta !== tb) return ta - tb;
			return String(a.id || "").localeCompare(String(b.id || ""));
		});

		for (let i = 1; i < group.length; i += 1) {
			const record = group[i];
			const owner = recordString(record, "owner");
			let nextKey = repairPublishJobIdempotencyKey(record.id);
			while (usedKeys.has(`${owner}\0${nextKey}`)) {
				nextKey = repairPublishJobIdempotencyKey(`${record.id}-${i}`);
			}
			usedKeys.add(`${owner}\0${nextKey}`);
			record.set("idempotency_key", nextKey);
			dirtyRecords.push(record);
			duplicatesFixed += 1;
		}
	}

	for (const record of dirtyRecords) {
		if (typeof app.saveNoValidate === "function") {
			app.saveNoValidate(record);
		} else {
			app.save(record);
		}
	}

	return { changed: dirtyRecords.length, duplicatesFixed };
}

migrate((app) => {
	const jobs = findCollectionSafe(app, "publish_jobs");
	if (!jobs) return;

	if (collectionHasIndexMarker(jobs, PUBLISH_JOBS_OWNER_IDEMPOTENCY_INDEX_MARKER)) {
		return;
	}

	const existingIndexes = Array.isArray(jobs.indexes) ? jobs.indexes.slice() : [];
	const indexesWithoutUnique = existingIndexes.filter(
		(sql) => !String(sql).includes(PUBLISH_JOBS_OWNER_IDEMPOTENCY_INDEX_MARKER),
	);

	jobs.indexes = indexesWithoutUnique;
	app.save(jobs);

	dedupePublishJobOwnerIdempotencyKeys(app, jobs);

	const post = findCollectionSafe(app, "publish_jobs");
	if (!post) return;

	if (!collectionHasIndexMarker(post, PUBLISH_JOBS_OWNER_IDEMPOTENCY_INDEX_MARKER)) {
		ensureIndex(post, PUBLISH_JOBS_OWNER_IDEMPOTENCY_INDEX_SQL);
		app.save(post);
	}
}, (app) => {
	const jobs = findCollectionSafe(app, "publish_jobs");
	if (!jobs) return;

	const indexes = Array.isArray(jobs.indexes) ? jobs.indexes.slice() : [];
	const next = indexes.filter((sql) => !String(sql).includes(PUBLISH_JOBS_OWNER_IDEMPOTENCY_INDEX_MARKER));
	let dirty = next.length !== indexes.length;

	if (!next.some((sql) => String(sql).includes(PUBLISH_JOBS_IDEMPOTENCY_INDEX_MARKER))) {
		next.push(PUBLISH_JOBS_IDEMPOTENCY_INDEX_SQL);
		dirty = true;
	}

	if (dirty) {
		jobs.indexes = next;
		app.save(jobs);
	}
});
