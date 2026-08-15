/// <reference path="../pb_data/types.d.ts" />

/**
 * F3: atomically consume a Pinterest OAuth state.
 *
 * Exactly one concurrent callback may flip used false→true.
 * Implemented as a DB-side conditional UPDATE (not a JS read/patch).
 *
 * PocketBase 0.38 JSVM APIs used (see pb_hooks conventions + JSVM types):
 * - routerAdd()
 * - $apis.requireSuperuserAuth()
 * - $app.db().newQuery(sql).bind(params).execute() → sql.Result.rowsAffected()
 * - BadRequestError()
 *
 * Superuser-only (Express pocketbaseClient). Does not call Pinterest.
 * Does not open a second SQLite handle from Express.
 */

routerAdd("POST", "/api/pinterest/oauth-states/consume", (e) => {
	const SAFE_MESSAGE = "Pinterest connection could not be completed. Please try connecting again.";

	const body = (e.requestInfo() && e.requestInfo().body) || {};
	const id = String(body.id || "").trim();
	if (!id) {
		throw new BadRequestError(SAFE_MESSAGE);
	}

	let result;
	try {
		result = $app.db()
			.newQuery(
				"UPDATE pinterest_oauth_states SET used = true WHERE id = {:id} AND (used = false OR used = 0 OR used IS NULL) AND datetime(replace(replace(expires_at, 'T', ' '), 'Z', '')) > datetime('now')",
			)
			.bind({ id: id })
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
