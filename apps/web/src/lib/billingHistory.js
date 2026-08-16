/**
 * PR-19 — Customer billing history UI helpers.
 * Read-only list from GET /workspace/v1/billing/history.
 */

export const BILLING_HISTORY_PATH = '/workspace/v1/billing/history';

export function formatBillingHistoryAmount(item) {
	if (item?.amount == null || !Number.isFinite(Number(item.amount))) return '—';
	const amount = Number(item.amount);
	const currency = String(item.currency || 'USD').trim().toUpperCase() || 'USD';
	try {
		return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
	} catch {
		return `${currency} ${amount}`;
	}
}

export function formatBillingHistoryDate(value) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	return date.toLocaleString();
}
