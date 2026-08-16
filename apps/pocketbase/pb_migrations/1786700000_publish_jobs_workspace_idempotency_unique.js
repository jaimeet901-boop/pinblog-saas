/// <reference path="../pb_data/types.d.ts" />
/**
 * WP-P0-1 — Unique WordPress publish enqueue idempotency per owner + workspace.
 *
 * Replaces UNIQUE(owner, idempotency_key) with UNIQUE(owner, workspace, idempotency_key).
 * Does not rewrite 1786020000. No row re-keying: existing owner+key uniqueness
 * already implies owner+workspace+key uniqueness.
 */

const PUBLISH_JOBS_OWNER_IDEMPOTENCY_INDEX_MARKER = "idx_publish_jobs_owner_idempotency";
const PUBLISH_JOBS_OWNER_IDEMPOTENCY_INDEX_SQL =
	"CREATE UNIQUE INDEX `idx_publish_jobs_owner_idempotency` ON `publish_jobs` (`owner`, `idempotency_key`)";
const PUBLISH_JOBS_OWNER_WORKSPACE_IDEMPOTENCY_INDEX_MARKER = "idx_publish_jobs_owner_workspace_idempotency";
const PUBLISH_JOBS_OWNER_WORKSPACE_IDEMPOTENCY_INDEX_SQL =
	"CREATE UNIQUE INDEX `idx_publish_jobs_owner_workspace_idempotency` ON `publish_jobs` (`owner`, `workspace`, `idempotency_key`)";

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

function indexesWithoutMarker(collection, marker) {
	const indexes = Array.isArray(collection?.indexes) ? collection.indexes.slice() : [];
	return indexes.filter((sql) => !String(sql).includes(marker));
}

migrate((app) => {
	const jobs = findCollectionSafe(app, "publish_jobs");
	if (!jobs) return;

	let next = indexesWithoutMarker(jobs, PUBLISH_JOBS_OWNER_IDEMPOTENCY_INDEX_MARKER);
	if (!next.some((sql) => String(sql).includes(PUBLISH_JOBS_OWNER_WORKSPACE_IDEMPOTENCY_INDEX_MARKER))) {
		next.push(PUBLISH_JOBS_OWNER_WORKSPACE_IDEMPOTENCY_INDEX_SQL);
	}

	const previous = Array.isArray(jobs.indexes) ? jobs.indexes : [];
	if (next.join("\n") === previous.join("\n")) return;

	jobs.indexes = next;
	app.save(jobs);
}, (app) => {
	const jobs = findCollectionSafe(app, "publish_jobs");
	if (!jobs) return;

	let next = indexesWithoutMarker(jobs, PUBLISH_JOBS_OWNER_WORKSPACE_IDEMPOTENCY_INDEX_MARKER);
	if (!collectionHasIndexMarker({ indexes: next }, PUBLISH_JOBS_OWNER_IDEMPOTENCY_INDEX_MARKER)) {
		next.push(PUBLISH_JOBS_OWNER_IDEMPOTENCY_INDEX_SQL);
	}

	jobs.indexes = next;
	app.save(jobs);
});
