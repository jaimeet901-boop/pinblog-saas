/**
 * Product / conversion analytics for Premium Template funnel.
 * Persists via existing audit_logs (no new collections).
 * Never throws to callers for persistence failures.
 *
 * Security: workspaceId and currentPlan are taken ONLY from the authenticated
 * request context — client-supplied values are ignored.
 */

export const PRODUCT_EVENT_NAMES = Object.freeze([
	'template_gallery_view',
	'template_preview_open',
	'template_locked_click',
	'upgrade_modal_open',
	'upgrade_button_click',
	'subscription_page_open',
	'template_used',
	'template_generated',
]);

const ALLOWED = new Set(PRODUCT_EVENT_NAMES);
const MAX_SOURCE_PAGE = 120;
const MAX_TEMPLATE_NAME = 200;
const MAX_TEMPLATE_ID = 80;

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function asStringArray(value) {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 40);
}

/**
 * Build a trusted product-event payload (pure — no I/O).
 * @param {object} req
 * @param {object} payload
 * @returns {{ event: string, templateId: string, templateName: string, workspaceKey: string, metadata: object, occurredAt: string }}
 */
export function buildTrustedProductEvent(req, payload = {}) {
	if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
		throw httpError(422, 'Product event payload must be an object', 'VALIDATION_ERROR');
	}

	const event = String(payload.event || payload.name || '').trim();
	if (!ALLOWED.has(event)) {
		throw httpError(422, `Unknown product event: ${event || '(empty)'}`, 'VALIDATION_ERROR');
	}

	const templateId = String(payload.templateId || payload.template_id || '').trim().slice(0, MAX_TEMPLATE_ID);
	const templateName = String(payload.templateName || payload.template_name || '').trim().slice(0, MAX_TEMPLATE_NAME);
	const sourcePage = String(payload.sourcePage || payload.source || '').trim().slice(0, MAX_SOURCE_PAGE);
	const missingKeys = asStringArray(payload.missingKeys || payload.missing_keys);
	const requiredFeatureKeys = asStringArray(
		payload.requiredFeatureKeys || payload.required_feature_keys,
	);

	const clientTimestamp = String(payload.timestamp || '').trim().slice(0, 40);
	const occurredAt = new Date().toISOString();

	// Trusted identity — never take workspaceId / currentPlan from the client.
	const workspaceId = String(req.workspace?.id || '').trim().slice(0, MAX_TEMPLATE_ID);
	const workspaceKey = String(req.workspaceKey || req.workspace?.workspace_key || '').trim();
	const currentPlan = String(
		req.workspace?.plan_slug
		|| req.workspaceSubscription?.expand?.plan?.slug
		|| '',
	).trim().slice(0, 80);

	const metadata = {
		event,
		templateId: templateId || undefined,
		templateName: templateName || undefined,
		workspaceId: workspaceId || undefined,
		workspaceKey: workspaceKey || undefined,
		currentPlan: currentPlan || undefined,
		missingKeys,
		requiredFeatureKeys,
		sourcePage: sourcePage || undefined,
		timestamp: occurredAt,
		clientTimestamp: clientTimestamp || undefined,
	};

	return {
		event,
		templateId,
		templateName,
		workspaceKey,
		metadata,
		occurredAt,
	};
}

/**
 * Normalize and persist a product event. Backend fills workspace/plan when available.
 * @param {object} req
 * @param {object} payload
 * @returns {Promise<{ ok: true, event: string }>}
 */
export async function recordProductEvent(req, payload = {}) {
	const built = buildTrustedProductEvent(req, payload);

	// Persistence must never break the request path.
	try {
		const { writeAuditLog } = await import('./audit/write.js');
		await writeAuditLog({
			category: 'billing',
			uiCategory: 'Product',
			severity: 'info',
			action: built.event,
			message: built.templateName
				? `${built.event}: ${built.templateName}`
				: built.event,
			result: 'ok',
			actorUserId: req.pocketbaseUserId || undefined,
			workspaceId: req.workspace?.id || undefined,
			workspaceKey: built.workspaceKey,
			workspaceLabel: req.workspace?.name || '',
			resourceType: built.templateId ? 'template' : 'product_event',
			resourceId: built.templateId || built.event,
			ip: req.ip || '',
			userAgent: req.get?.('user-agent') || '',
			service: 'product-events',
			metadata: built.metadata,
			occurredAt: built.occurredAt,
		});
	} catch {
		// Swallow persistence errors — analytics never blocks product flows.
	}

	return { ok: true, event: built.event };
}

export function isKnownProductEvent(name) {
	return ALLOWED.has(String(name || '').trim());
}
