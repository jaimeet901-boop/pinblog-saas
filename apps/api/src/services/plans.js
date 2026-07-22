import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { DEFAULT_FEATURES, DEFAULT_LIMITS, PLAN_SEED_CATALOG } from './plan-catalog.js';

function slugify(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
}

function requireNumber(value, field, { min = 0, allowZero = true } = {}) {
	const num = Number(value);
	if (!Number.isFinite(num)) {
		throw httpError(422, `${field} must be a number`, 'VALIDATION_ERROR');
	}
	if (allowZero ? num < min : num <= min) {
		throw httpError(422, `${field} must be ${allowZero ? '>=' : '>'} ${min}`, 'VALIDATION_ERROR');
	}
	return num;
}

function normalizeLimits(input) {
	const source = input && typeof input === 'object' ? input : {};
	const limits = { ...DEFAULT_LIMITS };
	for (const key of Object.keys(DEFAULT_LIMITS)) {
		if (source[key] != null) {
			limits[key] = requireNumber(source[key], `limits.${key}`, { min: 0 });
		}
	}
	return limits;
}

function normalizeFeatures(input) {
	const source = input && typeof input === 'object' ? input : {};
	const features = { ...DEFAULT_FEATURES };
	for (const key of Object.keys(DEFAULT_FEATURES)) {
		if (source[key] != null) features[key] = Boolean(source[key]);
	}
	return features;
}

function formatLimit(value) {
	if (value == null) return '—';
	if (Number(value) >= 999999) return 'Custom';
	return Number(value);
}

export function mapPlanDto(record, stats = {}) {
	const limits = record.limits && typeof record.limits === 'object' ? record.limits : DEFAULT_LIMITS;
	const features = record.features && typeof record.features === 'object' ? record.features : DEFAULT_FEATURES;
	const active = record.active !== false && record.status !== 'hidden' && record.status !== 'deprecated';

	return {
		id: record.id,
		name: record.name,
		slug: record.slug,
		code: record.slug,
		description: record.description || '',
		price: Number(record.monthly_price) || 0,
		monthlyPrice: Number(record.monthly_price) || 0,
		yearlyPrice: Number(record.yearly_price) || 0,
		currency: record.currency || 'USD',
		active,
		displayOrder: Number(record.display_order) || 0,
		status: record.status || (active ? 'active' : 'hidden'),
		credits: Number(record.credits) || 0,
		bonusCredits: Number(record.bonus_credits) || 0,
		rollover: Boolean(record.rollover),
		topupAllowed: Boolean(record.topup_allowed),
		subscribers: Number(stats.subscribers || 0),
		avgUsage: Number(stats.avgUsage || 0),
		maxWorkspaces: formatLimit(limits.maxWorkspaces),
		maxWordpress: formatLimit(limits.wordpressSites),
		maxPinterest: formatLimit(limits.pinterestAccounts),
		storageGb: formatLimit(limits.storageGb),
		aiModels: record.ai_models || '',
		priorityQueue: Boolean(features.priorityQueue),
		priorityProcessing: Boolean(features.priorityQueue),
		apiAccess: Boolean(features.apiAccess),
		support: record.support || '',
		refillPolicy: record.refill_policy || '',
		publishingLimits: record.publishing_limits || '',
		aiFeatures: record.ai_features || '',
		imageLimits: record.image_limits || '',
		highlight: Boolean(record.highlight),
		limits,
		features,
		created: record.created,
		updated: record.updated,
	};
}

async function getPlanStats() {
	const [subscriptions, usage] = await Promise.all([
		pocketbaseClient.collection('workspace_subscriptions').getFullList({ requestKey: null }).catch(() => []),
		pocketbaseClient.collection('workspace_usage').getFullList({ requestKey: null }).catch(() => []),
	]);

	const byPlan = {};
	for (const sub of subscriptions) {
		const planId = typeof sub.plan === 'string' ? sub.plan : sub.plan;
		if (!byPlan[planId]) byPlan[planId] = { subscribers: 0, usageSum: 0, usageCount: 0 };
		if (sub.status === 'active' || sub.status === 'trialing') {
			byPlan[planId].subscribers += 1;
		}
	}

	const usageByWorkspace = {};
	for (const row of usage) {
		usageByWorkspace[row.workspace_key] = (usageByWorkspace[row.workspace_key] || 0) + Number(row.credits_burned || 0);
	}

	for (const sub of subscriptions) {
		const planId = sub.plan;
		const burned = usageByWorkspace[sub.workspace_key] || 0;
		if (!byPlan[planId]) byPlan[planId] = { subscribers: 0, usageSum: 0, usageCount: 0 };
		byPlan[planId].usageSum += burned;
		byPlan[planId].usageCount += 1;
	}

	const result = {};
	for (const [planId, data] of Object.entries(byPlan)) {
		result[planId] = {
			subscribers: data.subscribers,
			avgUsage: data.usageCount ? Math.round(data.usageSum / data.usageCount) : 0,
		};
	}
	return result;
}

export async function ensurePlansSeeded() {
	const existing = await pocketbaseClient.collection('plans').getFullList({
		fields: 'id,slug',
		requestKey: null,
	}).catch(() => []);
	const bySlug = Object.fromEntries(existing.map((item) => [item.slug, item]));

	for (const seed of PLAN_SEED_CATALOG) {
		let plan = bySlug[seed.slug];
		if (!plan) {
			plan = await pocketbaseClient.collection('plans').create({
				name: seed.name,
				slug: seed.slug,
				description: seed.description,
				monthly_price: seed.monthly_price,
				yearly_price: seed.yearly_price,
				currency: seed.currency,
				active: seed.active,
				display_order: seed.display_order,
				credits: seed.credits,
				bonus_credits: seed.bonus_credits,
				rollover: seed.rollover,
				topup_allowed: seed.topup_allowed,
				limits: seed.limits,
				features: seed.features,
				support: seed.support,
				refill_policy: seed.refill_policy,
				publishing_limits: seed.publishing_limits,
				ai_features: seed.ai_features,
				image_limits: seed.image_limits,
				ai_models: seed.ai_models,
				highlight: seed.highlight,
				status: seed.status,
			});
		}

		for (const sub of seed.seedSubscribers || []) {
			try {
				await pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
					pocketbaseClient.filter('workspace_key = {:key}', { key: sub.workspace_key }),
				);
			} catch {
				const now = new Date();
				const end = new Date(now);
				end.setMonth(end.getMonth() + 1);
				await pocketbaseClient.collection('workspace_subscriptions').create({
					workspace_key: sub.workspace_key,
					workspace_name: sub.workspace_name,
					owner_email: sub.owner_email || '',
					plan: plan.id,
					status: sub.status || 'active',
					seats: 1,
					current_period_start: now.toISOString(),
					current_period_end: end.toISOString(),
					credits_balance: sub.credits_balance || seed.credits,
				});

				const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
				await pocketbaseClient.collection('workspace_usage').create({
					workspace_key: sub.workspace_key,
					workspace_name: sub.workspace_name,
					period,
					articles: Math.round((seed.avgUsage || 0) * 0.1),
					images: Math.round((seed.avgUsage || 0) * 0.2),
					tokens: Math.round((seed.avgUsage || 0) * 40),
					queue_jobs: Math.round((seed.avgUsage || 0) * 0.05),
					publishing: Math.round((seed.avgUsage || 0) * 0.15),
					api_calls: Math.round((seed.avgUsage || 0) * 0.3),
					credits_burned: seed.avgUsage || 0,
				}).catch(() => null);

				if ((sub.credits_balance || 0) > 0) {
					await pocketbaseClient.collection('credit_transactions').create({
						workspace_key: sub.workspace_key,
						workspace_name: sub.workspace_name,
						amount: sub.credits_balance,
						type: 'grant',
						reason: 'Initial plan credit allocation',
						balance: sub.credits_balance,
						created_by: 'system',
						metadata: { seed: true },
					}).catch(() => null);
				}
			}
		}
	}
}

export async function listPlans() {
	await ensurePlansSeeded();
	const records = await pocketbaseClient.collection('plans').getFullList({
		sort: 'display_order,name',
		requestKey: null,
	});
	const stats = await getPlanStats();
	return {
		items: records.map((record) => mapPlanDto(record, stats[record.id])),
		totalItems: records.length,
	};
}

export async function getPlanById(id) {
	const record = await pocketbaseClient.collection('plans').getOne(id);
	const stats = await getPlanStats();
	return mapPlanDto(record, stats[record.id]);
}

async function assertUniqueSlug(slug, excludeId = '') {
	const filter = excludeId
		? pocketbaseClient.filter('slug = {:slug} && id != {:id}', { slug, id: excludeId })
		: pocketbaseClient.filter('slug = {:slug}', { slug });
	try {
		await pocketbaseClient.collection('plans').getFirstListItem(filter);
		throw httpError(409, `Plan slug "${slug}" already exists`, 'CONFLICT');
	} catch (error) {
		if (error?.errorCode === 'CONFLICT') throw error;
	}
}

function buildPlanPayload(payload, { partial = false, existing = null } = {}) {
	const name = payload.name != null ? String(payload.name).trim() : existing?.name;
	if (!partial || payload.name != null) {
		if (!name) throw httpError(422, 'name is required', 'VALIDATION_ERROR');
	}

	const slug = payload.slug != null
		? slugify(payload.slug)
		: (payload.name != null ? slugify(payload.name) : existing?.slug);
	if (!partial || payload.slug != null || payload.name != null) {
		if (!slug) throw httpError(422, 'slug is required', 'VALIDATION_ERROR');
	}

	if (!partial) {
		if (payload.monthlyPrice == null && payload.price == null) {
			throw httpError(422, 'monthlyPrice is required', 'VALIDATION_ERROR');
		}
	}

	const monthlyPrice = payload.monthlyPrice != null || payload.price != null
		? requireNumber(payload.monthlyPrice ?? payload.price, 'monthlyPrice', { min: 0 })
		: existing?.monthly_price;
	const yearlyPrice = payload.yearlyPrice != null
		? requireNumber(payload.yearlyPrice, 'yearlyPrice', { min: 0 })
		: (existing?.yearly_price ?? (monthlyPrice != null ? monthlyPrice * 10 : 0));

	if (!partial) {
		normalizeLimits(payload.limits);
		normalizeFeatures(payload.features);
	}

	const limits = payload.limits != null ? normalizeLimits(payload.limits) : (existing?.limits || DEFAULT_LIMITS);
	const features = payload.features != null ? normalizeFeatures(payload.features) : (existing?.features || DEFAULT_FEATURES);

	const active = payload.active != null
		? Boolean(payload.active)
		: (payload.status ? payload.status === 'active' : existing?.active !== false);

	return {
		name,
		slug,
		description: payload.description != null ? String(payload.description) : (existing?.description || ''),
		monthly_price: monthlyPrice ?? 0,
		yearly_price: yearlyPrice ?? 0,
		currency: payload.currency || existing?.currency || 'USD',
		active,
		display_order: payload.displayOrder != null
			? requireNumber(payload.displayOrder, 'displayOrder', { min: 0 })
			: (existing?.display_order ?? 100),
		credits: payload.credits != null ? requireNumber(payload.credits, 'credits', { min: 0 }) : (existing?.credits ?? 0),
		bonus_credits: payload.bonusCredits != null ? requireNumber(payload.bonusCredits, 'bonusCredits', { min: 0 }) : (existing?.bonus_credits ?? 0),
		rollover: payload.rollover != null ? Boolean(payload.rollover) : Boolean(existing?.rollover),
		topup_allowed: payload.topupAllowed != null ? Boolean(payload.topupAllowed) : Boolean(existing?.topup_allowed),
		limits,
		features,
		support: payload.support != null ? String(payload.support) : (existing?.support || ''),
		refill_policy: payload.refillPolicy != null ? String(payload.refillPolicy) : (existing?.refill_policy || ''),
		publishing_limits: payload.publishingLimits != null ? String(payload.publishingLimits) : (existing?.publishing_limits || ''),
		ai_features: payload.aiFeatures != null ? String(payload.aiFeatures) : (existing?.ai_features || ''),
		image_limits: payload.imageLimits != null ? String(payload.imageLimits) : (existing?.image_limits || ''),
		ai_models: payload.aiModels != null ? String(payload.aiModels) : (existing?.ai_models || ''),
		highlight: payload.highlight != null ? Boolean(payload.highlight) : Boolean(existing?.highlight),
		status: payload.status || (active ? 'active' : 'hidden'),
	};
}

export async function createPlan(payload = {}) {
	if (!payload.limits || typeof payload.limits !== 'object') {
		throw httpError(422, 'limits are required', 'VALIDATION_ERROR');
	}
	if (!payload.features || typeof payload.features !== 'object') {
		throw httpError(422, 'features are required', 'VALIDATION_ERROR');
	}
	const data = buildPlanPayload(payload, { partial: false });
	await assertUniqueSlug(data.slug);
	const record = await pocketbaseClient.collection('plans').create(data);
	return getPlanById(record.id);
}

export async function updatePlan(id, payload = {}) {
	const existing = await pocketbaseClient.collection('plans').getOne(id);
	const data = buildPlanPayload(payload, { partial: true, existing });
	if (data.slug !== existing.slug) {
		await assertUniqueSlug(data.slug, id);
	}
	await pocketbaseClient.collection('plans').update(id, data);
	return getPlanById(id);
}

export async function duplicatePlan(id) {
	const existing = await getPlanById(id);
	const slugBase = `${existing.slug}-copy`;
	let slug = slugBase;
	let i = 2;
	while (true) {
		try {
			await assertUniqueSlug(slug);
			break;
		} catch {
			slug = `${slugBase}-${i++}`;
		}
	}
	return createPlan({
		name: `${existing.name} Copy`,
		slug,
		description: existing.description,
		monthlyPrice: existing.monthlyPrice,
		yearlyPrice: existing.yearlyPrice,
		currency: existing.currency,
		active: false,
		displayOrder: existing.displayOrder + 1,
		credits: existing.credits,
		bonusCredits: existing.bonusCredits,
		rollover: existing.rollover,
		topupAllowed: existing.topupAllowed,
		limits: existing.limits,
		features: existing.features,
		support: existing.support,
		refillPolicy: existing.refillPolicy,
		publishingLimits: existing.publishingLimits,
		aiFeatures: existing.aiFeatures,
		imageLimits: existing.imageLimits,
		aiModels: existing.aiModels,
		highlight: false,
		status: 'hidden',
	});
}

export async function setPlanEnabled(id, enabled) {
	await pocketbaseClient.collection('plans').update(id, {
		active: Boolean(enabled),
		status: enabled ? 'active' : 'hidden',
	});
	return getPlanById(id);
}

export async function deletePlan(id) {
	const activeSubs = await pocketbaseClient.collection('workspace_subscriptions').getList(1, 1, {
		filter: pocketbaseClient.filter('plan = {:plan} && (status = "active" || status = "trialing")', { plan: id }),
	}).catch(() => ({ totalItems: 0 }));

	if (activeSubs.totalItems > 0) {
		throw httpError(400, 'Cannot delete a plan with active subscriptions', 'PLAN_IN_USE');
	}

	await pocketbaseClient.collection('plans').delete(id);
	return { ok: true, id };
}

export async function assignWorkspacePlan(payload = {}) {
	const workspaceKey = slugify(payload.workspaceKey || payload.workspace_key || payload.workspaceName || payload.workspace_name);
	const workspaceName = String(payload.workspaceName || payload.workspace_name || workspaceKey).trim();
	if (!workspaceKey || !workspaceName) {
		throw httpError(422, 'workspaceKey and workspaceName are required', 'VALIDATION_ERROR');
	}
	const plan = await pocketbaseClient.collection('plans').getOne(payload.planId || payload.plan);
	const now = new Date();
	const end = new Date(now);
	end.setMonth(end.getMonth() + 1);

	let existing = null;
	try {
		existing = await pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
			pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
		);
	} catch {
		existing = null;
	}

	const body = {
		workspace_key: workspaceKey,
		workspace_name: workspaceName,
		owner_email: payload.ownerEmail || existing?.owner_email || '',
		plan: plan.id,
		status: payload.status || 'active',
		seats: Number(payload.seats) || existing?.seats || 1,
		current_period_start: now.toISOString(),
		current_period_end: end.toISOString(),
		credits_balance: Number(payload.creditsBalance ?? existing?.credits_balance ?? plan.credits) || 0,
	};

	const record = existing
		? await pocketbaseClient.collection('workspace_subscriptions').update(existing.id, body)
		: await pocketbaseClient.collection('workspace_subscriptions').create(body);

	return {
		id: record.id,
		workspaceKey: record.workspace_key,
		workspaceName: record.workspace_name,
		planId: plan.id,
		planName: plan.name,
		status: record.status,
		creditsBalance: record.credits_balance,
	};
}

export async function listSubscriptions() {
	await ensurePlansSeeded();
	const records = await pocketbaseClient.collection('workspace_subscriptions').getFullList({
		expand: 'plan',
		sort: '-updated',
		requestKey: null,
	});
	return {
		items: records.map((record) => ({
			id: record.id,
			workspaceKey: record.workspace_key,
			workspaceName: record.workspace_name,
			ownerEmail: record.owner_email,
			planId: typeof record.plan === 'string' ? record.plan : record.expand?.plan?.id,
			planName: record.expand?.plan?.name || '',
			planSlug: record.expand?.plan?.slug || '',
			status: record.status,
			seats: record.seats,
			creditsBalance: record.credits_balance,
			currentPeriodEnd: record.current_period_end,
		})),
		totalItems: records.length,
	};
}
