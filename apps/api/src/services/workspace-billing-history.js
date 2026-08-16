/**
 * PR-19 — Customer billing history from existing billing_events.
 * Workspace isolation comes only from req.workspaceKey (resolveWorkspace).
 */

export const CUSTOMER_BILLING_HISTORY_PATH = '/billing/history';

export const CUSTOMER_BILLING_EVENT_TYPES = Object.freeze([
	'credits_purchased',
	'renewed',
	'upgrade',
	'downgrade',
	'cancelled',
	'payment_failed',
	'trial_end',
	'grace_start',
	'plan_assign',
]);

export const CUSTOMER_BILLING_TYPE_LABELS = Object.freeze({
	credits_purchased: 'Credit pack',
	renewed: 'Renewal',
	upgrade: 'Upgrade',
	downgrade: 'Downgrade',
	cancelled: 'Cancellation',
	payment_failed: 'Payment failed',
	trial_end: 'Trial ended',
	grace_start: 'Grace period',
	plan_assign: 'Plan update',
});

const CANCEL_NOISE_PATTERN = /claim|duplicate|in progress|reclaim|recovered|idempotenc/i;

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function eventTypeOf(row = {}) {
	return String(row.event_type || row.eventType || '').trim();
}

function workspaceKeyOf(row = {}) {
	return String(row.workspace_key || row.workspaceKey || '').trim();
}

export function isCustomerFacingBillingEvent(row = {}) {
	const type = eventTypeOf(row);
	if (!CUSTOMER_BILLING_EVENT_TYPES.includes(type)) return false;
	if (type === 'topup') return false;
	if (type === 'cancelled') {
		const message = String(row.message || '').trim();
		if (CANCEL_NOISE_PATTERN.test(message)) return false;
	}
	return true;
}

export function mapCustomerBillingEvent(row = {}) {
	const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
	const type = eventTypeOf(row);
	const amountRaw = meta.amountSnapshot ?? meta.providerAmount ?? meta.amount;
	const amountNumber = Number(amountRaw);
	const amount = Number.isFinite(amountNumber) ? amountNumber : null;
	const provider = String(meta.providerSnapshot || meta.provider || '').trim();
	return {
		id: row.id,
		date: row.occurred_at || row.occurredAt || row.created || null,
		type,
		label: CUSTOMER_BILLING_TYPE_LABELS[type] || type,
		message: String(row.message || '').slice(0, 1000),
		amount,
		currency: String(meta.currencySnapshot || meta.currency || 'USD').slice(0, 8).toUpperCase(),
		provider: provider || null,
		fromPlan: String(row.from_plan || row.fromPlan || ''),
		toPlan: String(row.to_plan || row.toPlan || ''),
	};
}

async function defaultListEvents(workspaceKey, { perPage } = {}) {
	const pocketbaseClient = (await import('../utils/pocketbaseClient.js')).default;
	const typeClause = CUSTOMER_BILLING_EVENT_TYPES
		.map((_, index) => `event_type = {:t${index}}`)
		.join(' || ');
	const params = { key: workspaceKey };
	CUSTOMER_BILLING_EVENT_TYPES.forEach((type, index) => {
		params[`t${index}`] = type;
	});
	const filter = pocketbaseClient.filter(
		`workspace_key = {:key} && (${typeClause})`,
		params,
	);
	return pocketbaseClient.collection('billing_events').getList(1, perPage, {
		filter,
		sort: '-occurred_at,-created',
		requestKey: null,
	}).catch(() => ({ items: [], totalItems: 0 }));
}

/**
 * Customer billing history for the authenticated workspace.
 * Ignores query.workspaceKey / query.workspace_id — isolation is req.workspaceKey only.
 */
export async function getWorkspaceBillingHistory(req, query = {}, options = {}) {
	const assertFn = options.assertCapability
		|| (await import('./workspace-rbac.js')).assertCapability;
	assertFn(req, 'workspace.billing.manage');

	const workspaceKey = String(req.workspaceKey || '').trim();
	if (!workspaceKey) {
		throw httpError(422, 'Workspace is required', 'VALIDATION_ERROR');
	}

	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(50, Math.max(1, Number(query.perPage) || 20));
	const listEvents = options.listEvents || defaultListEvents;

	const raw = await listEvents(workspaceKey, { page: 1, perPage: 100 });
	const items = (raw.items || [])
		.filter((row) => workspaceKeyOf(row) === workspaceKey)
		.filter(isCustomerFacingBillingEvent)
		.map(mapCustomerBillingEvent);

	const start = (page - 1) * perPage;
	return {
		items: items.slice(start, start + perPage),
		page,
		perPage,
		totalItems: items.length,
		totalPages: Math.max(1, Math.ceil(items.length / perPage) || 1),
	};
}
