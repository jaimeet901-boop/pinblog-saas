/// <reference path="../pb_data/types.d.ts" />

/**
 * P0 #2: atomically claim a WordPress publish_jobs row.
 *
 * Exactly one concurrent worker may transition queued|scheduled → publishing.
 * Implemented as a DB-side conditional UPDATE (not a JS read/patch).
 *
 * PocketBase 0.38 JSVM APIs used (see pb_hooks conventions + JSVM types):
 * - routerAdd()
 * - $apis.requireSuperuserAuth()
 * - $app.db().newQuery(sql).bind(params).execute() → sql.Result.rowsAffected()
 * - BadRequestError()
 *
 * Superuser-only (Express pocketbaseClient). Does not call WordPress.
 * Does not open a second SQLite handle from Express.
 */

routerAdd("POST", "/api/wordpress/publish-jobs/claim", (e) => {
	const SAFE_MESSAGE = "WordPress publish job could not be claimed.";

	const body = (e.requestInfo() && e.requestInfo().body) || {};
	const id = String(body.id || "").trim();
	const token = String(body.claim_token || "").trim();
	const startedAt = String(body.started_at || "").trim();
	if (!id || !token || !startedAt) {
		throw new BadRequestError(SAFE_MESSAGE);
	}

	let result;
	try {
		result = $app.db()
			.newQuery(
				"UPDATE publish_jobs SET status = 'publishing', claim_token = {:token}, claim_version = COALESCE(claim_version, 0) + 1, started_at = CASE WHEN started_at IS NULL OR started_at = '' THEN {:started} ELSE started_at END, progress = 10 WHERE id = {:id} AND status IN ('queued', 'scheduled')",
			)
			.bind({
				id: id,
				token: token,
				started: startedAt,
			})
			.execute();
	} catch (_) {
		throw new BadRequestError(SAFE_MESSAGE);
	}

	let affected = 0;
	try {
		if (result && typeof result.rowsAffected === "function") {
			affected = Number(result.rowsAffected());
		} else if (result && result.rowsAffected != null) {
			affected = Number(result.rowsAffected);
		}
	} catch (_) {
		affected = 0;
	}

	if (affected !== 1) {
		throw new BadRequestError(SAFE_MESSAGE);
	}

	return e.json(200, { ok: true, id: id });
}, $apis.requireSuperuserAuth());
