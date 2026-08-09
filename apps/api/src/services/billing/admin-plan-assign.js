import { validateActivationSource, validateBillingSource } from './billing-model.js';

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

export const OVERRIDE_REASON_MAX_LENGTH = 500;
export const OVERRIDE_ACTOR_MAX_LENGTH = 120;

const PADDLE_IDENTITY_FIELDS = Object.freeze([
	'paddle_customer_id',
	'paddle_subscription_id',
	'paddle_transaction_id',
	'paddle_price_id',
]);

/**
 * Validate explicit admin override reason from assign payload.
 * Accepts reason | overrideReason | override_reason.
 */
export function validateAdminOverrideReason(payload = {}) {
	const raw = payload.reason ?? payload.overrideReason ?? payload.override_reason;
	if (raw == null || (typeof raw !== 'string' && typeof raw !== 'number')) {
		throw httpError(422, 'reason is required for admin plan assignment', 'VALIDATION_ERROR');
	}
	const reason = String(raw).trim();
	if (!reason) {
		throw httpError(422, 'reason is required for admin plan assignment', 'VALIDATION_ERROR');
	}
	if (reason.length > OVERRIDE_REASON_MAX_LENGTH) {
		throw httpError(
			422,
			`reason must be ${OVERRIDE_REASON_MAX_LENGTH} characters or fewer`,
			'VALIDATION_ERROR',
		);
	}
	return reason;
}

/**
 * Resolve server-side override actor. Client-supplied actor fields are ignored.
 */
export function resolveAdminOverrideActor(adminContext = {}, payload = {}) {
	void payload.override_actor;
	void payload.overrideActor;
	void payload.actor;

	const actor = String(
		adminContext.actorUserId
		|| adminContext.actor
		|| 'admin',
	).trim();
	return actor.slice(0, OVERRIDE_ACTOR_MAX_LENGTH);
}

export function buildAdminAssignMetadataFields(overrideActor, overrideReason) {
	const activation = validateActivationSource('admin_override', { allowEmpty: false });
	const billing = validateBillingSource('admin_override', { allowEmpty: false });
	if (!activation.ok || !billing.ok) {
		throw httpError(500, 'Admin override billing enums misconfigured', 'INTERNAL_ERROR');
	}
	return {
		activation_source: activation.value,
		billing_source: billing.value,
		override_actor: overrideActor,
		override_reason: overrideReason.slice(0, OVERRIDE_REASON_MAX_LENGTH),
	};
}

export function subscriptionPatchOmitsPaddleIdentityFields(patch = {}) {
	return PADDLE_IDENTITY_FIELDS.every((key) => !(key in patch));
}

export { PADDLE_IDENTITY_FIELDS };
