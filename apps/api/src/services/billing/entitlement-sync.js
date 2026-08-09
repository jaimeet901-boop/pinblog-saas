import {
	validateActivationSource,
	validateBillingSource,
} from './billing-model.js';

function debugSync(message, meta = {}) {
	if (process.env.NODE_ENV === 'test') return;
	import('../../utils/logger.js')
		.then(({ default: logger }) => logger.debug(message, meta))
		.catch(() => null);
}

async function resolvePocketbaseClient(override) {
	if (override) return override;
	const { default: pocketbaseClient } = await import('../../utils/pocketbaseClient.js');
	return pocketbaseClient;
}

/**
 * Resolve authoritative plan slug from a plan record passed by callers
 * after workspace_subscriptions.plan has already been written.
 */
export function resolveAuthoritativePlanSlug(plan = {}) {
	return String(plan.slug || plan.planSlug || '').trim().toLowerCase();
}

/**
 * Monotonic entitlement sync version — never decreases.
 * @param {number|string|null|undefined} current
 * @returns {number}
 */
export function computeNextEntitlementSyncVersion(current) {
	const parsed = Number(current);
	const safe = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
	return safe + 1;
}

/**
 * Validate optional sync source against Phase 1 enums (audit context only).
 * @param {string} source
 * @returns {{ ok: true, value: string, kind: 'activation'|'billing'|'unknown' } | { ok: false, value: string }}
 */
export function normalizeSyncSource(source = '') {
	const value = String(source || '').trim();
	if (!value) {
		return { ok: true, value: '', kind: 'unknown' };
	}

	const activation = validateActivationSource(value, { allowEmpty: false });
	if (activation.ok) {
		return { ok: true, value: activation.value, kind: 'activation' };
	}

	const billing = validateBillingSource(value, { allowEmpty: false });
	if (billing.ok) {
		return { ok: true, value: billing.value, kind: 'billing' };
	}

	return { ok: false, value };
}

/**
 * Synchronize entitlement mirrors from authoritative workspace_subscriptions.plan.
 *
 * Callers MUST write workspace_subscriptions first, then invoke this function.
 * Mirror failures are best-effort and never roll back authoritative state.
 *
 * @param {object} [options.client] — optional PocketBase client override (tests only)
 */
export async function syncEntitlementMirrors({
	workspaceKey,
	plan,
	subscriptionId = '',
	subscriptionRecord = null,
	actor = 'system',
	source = '',
	client = null,
} = {}) {
	const pb = await resolvePocketbaseClient(client);
	const key = String(workspaceKey || '').trim();
	const planSlug = resolveAuthoritativePlanSlug(plan);
	const sourceMeta = normalizeSyncSource(source);

	if (!key || !planSlug) {
		return {
			synced: false,
			reason: 'missing_workspace_key_or_plan',
			workspaceKey: key,
			planSlug,
			actor,
			source: sourceMeta.ok ? sourceMeta.value : sourceMeta.value || '',
		};
	}

	const workspace = await pb.collection('workspaces').getFirstListItem(
		pb.filter('workspace_key = {:key}', { key }),
		{ requestKey: null },
	).catch(() => null);

	if (!workspace) {
		debugSync('[entitlement-sync] workspace not found', {
			workspaceKey: key,
			planSlug,
			actor,
			source: sourceMeta.value || source,
		});
		return {
			synced: false,
			reason: 'workspace_not_found',
			workspaceKey: key,
			planSlug,
			actor,
			source: sourceMeta.ok ? sourceMeta.value : '',
		};
	}

	let workspaceMirrorUpdated = false;
	if (String(workspace.plan_slug || '').toLowerCase() !== planSlug) {
		await pb.collection('workspaces').update(workspace.id, {
			plan_slug: planSlug,
		}).catch((error) => {
			debugSync('[entitlement-sync] workspace mirror update failed', {
				workspaceKey: key,
				planSlug,
				error: error?.message || String(error),
			});
			return null;
		});
		workspaceMirrorUpdated = true;
	}

	let userMirrorUpdated = false;
	let ownerMissing = false;
	const ownerId = String(workspace.owner || '').trim();
	if (ownerId) {
		await pb.collection('users').update(ownerId, {
			plan: planSlug,
		}).catch((error) => {
			debugSync('[entitlement-sync] user mirror update failed', {
				workspaceKey: key,
				ownerId,
				planSlug,
				error: error?.message || String(error),
			});
			return null;
		});
		userMirrorUpdated = true;
	} else {
		ownerMissing = true;
		debugSync('[entitlement-sync] owner not resolved for user mirror', {
			workspaceKey: key,
			planSlug,
		});
	}

	let subscription = subscriptionRecord;
	if (!subscription && subscriptionId) {
		subscription = await pb.collection('workspace_subscriptions').getOne(
			subscriptionId,
			{ requestKey: null },
		).catch(() => null);
	}
	if (!subscription) {
		subscription = await pb.collection('workspace_subscriptions').getFirstListItem(
			pb.filter('workspace_key = {:key}', { key }),
			{ requestKey: null },
		).catch(() => null);
	}

	let entitlementSyncVersion = null;
	let lastEntitlementSyncAt = null;
	if (subscription?.id) {
		entitlementSyncVersion = computeNextEntitlementSyncVersion(subscription.entitlement_sync_version);
		lastEntitlementSyncAt = new Date().toISOString();
		await pb.collection('workspace_subscriptions').update(subscription.id, {
			entitlement_sync_version: entitlementSyncVersion,
			last_entitlement_sync_at: lastEntitlementSyncAt,
		}).catch((error) => {
			debugSync('[entitlement-sync] sync metadata update failed', {
				subscriptionId: subscription.id,
				error: error?.message || String(error),
			});
			return null;
		});
	}

	return {
		synced: true,
		workspaceKey: key,
		planSlug,
		workspaceId: workspace.id,
		workspaceMirrorUpdated,
		userMirrorUpdated,
		ownerMissing,
		entitlementSyncVersion,
		lastEntitlementSyncAt,
		actor,
		source: sourceMeta.ok ? sourceMeta.value : '',
		sourceKind: sourceMeta.ok ? sourceMeta.kind : 'unknown',
	};
}
