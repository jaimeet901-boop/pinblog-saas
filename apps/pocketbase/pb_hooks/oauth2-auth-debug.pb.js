/// <reference path="../pb_data/types.d.ts" />

/**
 * TEMPORARY OAuth2 auth diagnostics.
 * Logs the real error behind client "Failed to authenticate." (empty data {}).
 * Also rethrows a BadRequestError that includes the raw cause in `data`
 * so the browser Network tab for auth-with-oauth2 is actionable.
 *
 * Remove after Google login is diagnosed.
 */
onRecordAuthWithOAuth2Request((e) => {
	const collectionName = e?.collection?.name || "";
	if (collectionName && collectionName !== "users") {
		e.next();
		return;
	}

	const oauth2User = e?.oAuth2User || e?.oauth2User || null;
	const createData = e?.createData || {};
	const existing = e?.record || null;
	const isNew = e?.isNewRecord === true || existing == null;

	let mappedFields = null;
	try {
		mappedFields = e?.collection?.oauth2?.mappedFields || null;
	} catch (_) {
		mappedFields = null;
	}

	const pre = {
		provider: e?.providerName || "",
		isNewRecord: isNew,
		existingUserId: existing ? String(existing.id || "") : "",
		existingEmail: existing ? String(existing.get("email") || "") : "",
		oauthEmail: oauth2User ? String(oauth2User.email || "") : "",
		oauthId: oauth2User ? String(oauth2User.id || "") : "",
		oauthName: oauth2User ? String(oauth2User.name || "") : "",
		createDataKeys: Object.keys(createData || {}),
		mappedFields: mappedFields,
	};

	console.log("[oauth2-debug] auth-with-oauth2 start", JSON.stringify(pre));
	try {
		$app.logger().info("OAuth2 auth-with-oauth2 start", "meta", JSON.stringify(pre));
	} catch (_) {
		/* ignore */
	}

	try {
		return e.next();
	} catch (err) {
		const rawMessage = String(err?.message || err || "unknown");
		let rawData = null;
		try {
			if (err && typeof err.data === "function") {
				rawData = err.data();
			} else if (err && err.data !== undefined) {
				rawData = err.data;
			} else if (err && typeof err.rawData === "function") {
				rawData = err.rawData();
			}
		} catch (_) {
			rawData = null;
		}

		const debugPayload = {
			...pre,
			errorMessage: rawMessage,
			errorData: rawData,
			errorString: String(err),
		};

		console.log("[oauth2-debug] auth-with-oauth2 FAILED", JSON.stringify(debugPayload));
		try {
			$app.logger().error(
				"OAuth2 auth-with-oauth2 FAILED",
				"error",
				rawMessage,
				"meta",
				JSON.stringify(debugPayload),
			);
		} catch (_) {
			/* ignore */
		}

		// Surface the real cause to the client Network tab (data is otherwise {}).
		throw new BadRequestError(`Failed to authenticate. (${rawMessage})`, {
			oauth2Debug: debugPayload,
		});
	}
}, "users");

onRecordCreateRequest((e) => {
	try {
		if (e?.collection?.name !== "users") {
			e.next();
			return;
		}
		const info = {
			email: String(e.record?.get("email") || ""),
			name: String(e.record?.get("name") || ""),
			plan: String(e.record?.get("plan") || ""),
			role: String(e.record?.get("role") || ""),
			verified: e.record?.get("verified"),
			hasSuperuser: typeof e.hasSuperuserAuth === "function" ? e.hasSuperuserAuth() : null,
		};
		console.log("[oauth2-debug] users create request", JSON.stringify(info));
	} catch (error) {
		console.log("[oauth2-debug] users create log skipped", String(error?.message || error));
	}
	e.next();
}, "users");
