/// <reference path="../pb_data/types.d.ts" />

/**
 * TEMPORARY password-auth diagnostics.
 * Logs create/auth details for users email/password flow.
 * Exposes non-secret failure class in BadRequest data when auth fails.
 * Remove after password login is diagnosed.
 */

onRecordCreateRequest((e) => {
	try {
		if (e?.collection?.name !== "users") {
			e.next();
			return;
		}
		const email = String(e.record?.get("email") || "");
		const hasPassword = String(e.record?.get("password") || "") !== "";
		console.log("[password-debug] users.create request", JSON.stringify({
			email,
			emailLen: email.length,
			hasPassword,
			verified: e.record?.get("verified"),
			role: String(e.record?.get("role") || ""),
			plan: String(e.record?.get("plan") || ""),
			hasSuperuser: typeof e.hasSuperuserAuth === "function" ? e.hasSuperuserAuth() : null,
		}));
	} catch (error) {
		console.log("[password-debug] create log skipped", String(error?.message || error));
	}
	e.next();
}, "users");

onRecordAfterCreateSuccess((e) => {
	try {
		if (e?.collection?.name !== "users" && e?.record?.collection?.()?.name !== "users") {
			return;
		}
		const email = String(e.record?.get("email") || "");
		console.log("[password-debug] users.create success", JSON.stringify({
			id: String(e.record?.get("id") || e.record?.id || ""),
			email,
			verified: e.record?.get("verified"),
			tokenKeyLen: String(e.record?.get("tokenKey") || "").length,
			// password hash presence only — never log the hash value
			hasPasswordHash: String(e.record?.get("password") || "") !== "",
		}));
	} catch (error) {
		console.log("[password-debug] create success log skipped", String(error?.message || error));
	}
}, "users");

onRecordAuthWithPasswordRequest((e) => {
	const collectionName = e?.collection?.name || "";
	if (collectionName && collectionName !== "users") {
		e.next();
		return;
	}

	const identity = String(e?.identity || "");
	const passwordLen = String(e?.password || "").length;
	const record = e?.record || null;
	const recordId = record ? String(record.get("id") || record.id || "") : "";
	const recordEmail = record ? String(record.get("email") || "") : "";
	let passwordValid = null;
	try {
		passwordValid = record ? !!record.validatePassword(String(e?.password || "")) : null;
	} catch (_) {
		passwordValid = "error";
	}

	console.log("[password-debug] auth-with-password start", JSON.stringify({
		identity,
		identityLen: identity.length,
		passwordLen,
		foundRecord: Boolean(record),
		recordId,
		recordEmail,
		emailsEqual: recordEmail !== "" && identity !== "" ? recordEmail === identity : null,
		emailsEqualIgnoreCase: recordEmail !== "" && identity !== ""
			? recordEmail.toLowerCase() === identity.toLowerCase()
			: null,
		passwordValid,
		verified: record ? record.get("verified") : null,
	}));

	try {
		e.next();
		console.log("[password-debug] auth-with-password OK", JSON.stringify({
			identity,
			recordId,
		}));
	} catch (error) {
		const msg = String(error?.message || error || "");
		console.log("[password-debug] auth-with-password FAILED", JSON.stringify({
			identity,
			identityLen: identity.length,
			passwordLen,
			foundRecord: Boolean(record),
			recordId,
			recordEmail,
			passwordValid,
			error: msg,
		}));
		throw new BadRequestError("Failed to authenticate.", {
			passwordDebug: {
				foundRecord: Boolean(record),
				passwordValid,
				identityLen: identity.length,
				passwordLen,
				emailsEqual: recordEmail !== "" && identity !== "" ? recordEmail === identity : null,
				emailsEqualIgnoreCase: recordEmail !== "" && identity !== ""
					? recordEmail.toLowerCase() === identity.toLowerCase()
					: null,
				recordIdPresent: Boolean(recordId),
			},
		});
	}
}, "users");
