/**
 * Premium Template funnel analytics (client).
 * Fire-and-forget — never throws, never blocks UI.
 */

import apiServerClient, { getActiveWorkspaceId } from '@/lib/apiServerClient';

export const PRODUCT_EVENTS = Object.freeze({
	TEMPLATE_GALLERY_VIEW: 'template_gallery_view',
	TEMPLATE_PREVIEW_OPEN: 'template_preview_open',
	TEMPLATE_LOCKED_CLICK: 'template_locked_click',
	UPGRADE_MODAL_OPEN: 'upgrade_modal_open',
	UPGRADE_BUTTON_CLICK: 'upgrade_button_click',
	SUBSCRIPTION_PAGE_OPEN: 'subscription_page_open',
	TEMPLATE_USED: 'template_used',
	TEMPLATE_GENERATED: 'template_generated',
});

const DEDUPE_TTL_MS = 4_000;
const recentKeys = new Map();

function pruneDedupe(now) {
	for (const [key, expires] of recentKeys) {
		if (expires <= now) recentKeys.delete(key);
	}
}

function shouldSkipDuplicate(dedupeKey) {
	if (!dedupeKey) return false;
	const now = Date.now();
	pruneDedupe(now);
	const expires = recentKeys.get(dedupeKey);
	if (expires && expires > now) return true;
	recentKeys.set(dedupeKey, now + DEDUPE_TTL_MS);
	return false;
}

function pickAccessFields(templateOrAccess) {
	const access = templateOrAccess?.access && typeof templateOrAccess.access === 'object'
		? templateOrAccess.access
		: (templateOrAccess && typeof templateOrAccess === 'object' && Array.isArray(templateOrAccess.missingKeys)
			? templateOrAccess
			: null);
	const requiredFeatureKeys = Array.isArray(templateOrAccess?.requiredFeatureKeys)
		? templateOrAccess.requiredFeatureKeys
		: [];
	return {
		missingKeys: Array.isArray(access?.missingKeys) ? access.missingKeys : [],
		requiredFeatureKeys,
	};
}

/**
 * Build a standard event payload from a template DTO + extras.
 * @param {object} [template]
 * @param {object} [extras]
 */
export function buildTemplateEventProps(template = null, extras = {}) {
	const accessFields = pickAccessFields(template || extras.access || null);
	return {
		templateId: String(template?.id || extras.templateId || '').trim() || undefined,
		templateName: String(template?.name || extras.templateName || '').trim() || undefined,
		workspaceId: String(extras.workspaceId || getActiveWorkspaceId() || '').trim() || undefined,
		currentPlan: String(extras.currentPlan || '').trim() || undefined,
		missingKeys: extras.missingKeys || accessFields.missingKeys,
		requiredFeatureKeys: extras.requiredFeatureKeys || accessFields.requiredFeatureKeys,
		sourcePage: String(extras.sourcePage || '').trim() || undefined,
		timestamp: extras.timestamp || new Date().toISOString(),
	};
}

/**
 * Track a product funnel event. Safe to call from any UI path.
 * @param {string} event
 * @param {object} [props]
 * @param {{ dedupeKey?: string, dedupe?: boolean }} [options]
 */
export function trackProductEvent(event, props = {}, options = {}) {
	try {
		const name = String(event || '').trim();
		if (!name) return;

		const dedupeKey = options.dedupe === false
			? ''
			: (options.dedupeKey || `${name}:${props.sourcePage || ''}:${props.templateId || ''}`);
		if (shouldSkipDuplicate(dedupeKey)) return;

		const body = {
			event: name,
			templateId: props.templateId || undefined,
			templateName: props.templateName || undefined,
			workspaceId: props.workspaceId || getActiveWorkspaceId() || undefined,
			currentPlan: props.currentPlan || undefined,
			missingKeys: Array.isArray(props.missingKeys) ? props.missingKeys : [],
			requiredFeatureKeys: Array.isArray(props.requiredFeatureKeys) ? props.requiredFeatureKeys : [],
			sourcePage: props.sourcePage || undefined,
			timestamp: props.timestamp || new Date().toISOString(),
		};

		void apiServerClient.fetch('/workspace/v1/product-events', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}).catch(() => {});
	} catch {
		// Analytics must never affect application flow.
	}
}

/** @deprecated test helper */
export function _resetProductEventDedupeForTests() {
	recentKeys.clear();
}
