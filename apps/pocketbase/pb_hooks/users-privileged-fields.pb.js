/// <reference path="../pb_data/types.d.ts" />
/**
 * Critical #2 belt-and-suspenders: strip / reset privileged users fields
 * for non-superuser create/update requests.
 *
 * API rules remain the primary control. Superuser (Express Admin / billing /
 * credits engine) continues to write privileged fields normally.
 */

const PRIVILEGED_FIELDS = [
	"role",
	"plan",
	"status",
	"ai_credits_used",
	"image_credits_used",
	"verified",
	"credits",
];

function isUsersCollection(e) {
	try {
		return e?.collection?.name === "users";
	} catch (_) {
		return false;
	}
}

function isSuperuserRequest(e) {
	try {
		if (typeof e.hasSuperuserAuth === "function" && e.hasSuperuserAuth()) {
			return true;
		}
	} catch (_) {
		/* ignore */
	}
	try {
		const auth = e.auth;
		if (auth && typeof auth.isSuperuser === "function" && auth.isSuperuser()) {
			return true;
		}
	} catch (_) {
		/* ignore */
	}
	return false;
}

onRecordCreateRequest((e) => {
	if (!isUsersCollection(e) || isSuperuserRequest(e)) {
		e.next();
		return;
	}

	try {
		e.record.set("role", "member");
		e.record.set("plan", "free");
		e.record.set("ai_credits_used", 0);
		e.record.set("image_credits_used", 0);
		e.record.set("verified", false);
		try {
			if (e.record.get("status") != null && e.record.get("status") !== "") {
				e.record.set("status", "active");
			}
		} catch (_) {
			/* status field may be absent */
		}
	} catch (error) {
		console.log("[users-privileged-fields] create harden skipped:", error?.message || error);
	}

	e.next();
});

onRecordUpdateRequest((e) => {
	if (!isUsersCollection(e) || isSuperuserRequest(e)) {
		e.next();
		return;
	}

	try {
		const original = e.record.original();
		for (let i = 0; i < PRIVILEGED_FIELDS.length; i += 1) {
			const field = PRIVILEGED_FIELDS[i];
			try {
				e.record.set(field, original.get(field));
			} catch (_) {
				/* field may not exist on this schema revision */
			}
		}
	} catch (error) {
		console.log("[users-privileged-fields] update harden skipped:", error?.message || error);
	}

	e.next();
});
