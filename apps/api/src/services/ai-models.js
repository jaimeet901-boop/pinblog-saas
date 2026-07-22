import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { ensureProviderCatalogSeeded } from './ai-providers.js';
import { MODEL_SEED_CATALOG } from './ai-model-catalog.js';

const CAPABILITIES = new Set(['text', 'image', 'vision', 'embedding']);
const STATUSES = new Set(['enabled', 'disabled', 'deprecated']);

function formatDate(value) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toISOString().slice(0, 10);
}

function formatMoney(value, unit = '1M') {
	if (value == null || value === '' || Number.isNaN(Number(value))) return '$—';
	const amount = Number(value);
	const pretty = Number.isInteger(amount) ? amount.toFixed(2) : String(amount);
	if (unit === 'image') return `$${pretty} / image`;
	return `$${pretty} / 1M`;
}

function parsePricing(value, fieldName) {
	if (value == null || value === '') return null;
	if (typeof value === 'string' && (value.includes('—') || value.includes('—'))) return null;
	const cleaned = typeof value === 'string'
		? value.replace(/[^0-9.]/g, '')
		: value;
	const num = Number(cleaned);
	if (!Number.isFinite(num) || num < 0) {
		throw httpError(422, `${fieldName} must be a non-negative number`, 'VALIDATION_ERROR');
	}
	return num;
}

function normalizeBool(value, fallback = false) {
	if (typeof value === 'boolean') return value;
	if (value == null) return fallback;
	if (value === 'true' || value === '1') return true;
	if (value === 'false' || value === '0') return false;
	return Boolean(value);
}

function buildFeatures({ supports_vision, supports_streaming, supports_function_calling, supports_reasoning, features }) {
	const fromFlags = [];
	if (supports_streaming) fromFlags.push('Streaming');
	if (supports_function_calling) fromFlags.push('Tools');
	if (supports_vision) fromFlags.push('Vision');
	if (supports_reasoning) fromFlags.push('Reasoning');
	const extra = Array.isArray(features) ? features.map(String) : [];
	return [...new Set([...fromFlags, ...extra])];
}

export function mapModelDto(record, providerRecord = null) {
	const provider = providerRecord || record.expand?.provider || null;
	const enabled = record.enabled !== false && record.status !== 'disabled' && record.status !== 'deprecated';
	const status = record.status || (enabled ? 'enabled' : 'disabled');
	const unit = record.pricing_unit || '1M';
	const outputMissing = record.output_pricing == null
		|| (record.capability === 'image' && Number(record.output_pricing) === 0);

	return {
		id: record.id,
		modelId: record.model_id,
		name: record.display_name || record.model_id,
		displayName: record.display_name || record.model_id,
		providerId: typeof record.provider === 'string' ? record.provider : provider?.id,
		provider: provider?.name || '',
		providerCode: provider?.code || '',
		capability: record.capability || 'text',
		capabilities: Array.isArray(record.capabilities) ? record.capabilities : [],
		contextWindow: Number(record.context_window) || 0,
		inputCost: formatMoney(record.input_pricing, unit),
		outputCost: outputMissing ? '$—' : formatMoney(record.output_pricing, unit === 'image' ? '1M' : unit),
		inputPricing: record.input_pricing == null ? null : Number(record.input_pricing),
		outputPricing: outputMissing ? null : Number(record.output_pricing),
		pricingUnit: unit,
		supportsVision: Boolean(record.supports_vision),
		supportsStreaming: Boolean(record.supports_streaming),
		supportsFunctionCalling: Boolean(record.supports_function_calling),
		supportsReasoning: Boolean(record.supports_reasoning),
		isDefault: Boolean(record.is_default),
		enabled,
		status,
		priority: Number(record.priority) || 100,
		version: record.version || '',
		fallbackModelId: record.fallback_model_id || '',
		features: Array.isArray(record.features) ? record.features : [],
		recommended: Array.isArray(record.recommended) ? record.recommended : [],
		updated: formatDate(record.updated),
		created: record.created,
		updatedAt: record.updated,
	};
}

async function getProviderByIdOrCode(value) {
	if (!value) {
		throw httpError(422, 'provider is required', 'VALIDATION_ERROR');
	}
	const raw = String(value).trim();
	try {
		return await pocketbaseClient.collection('ai_providers').getOne(raw);
	} catch {
		try {
			return await pocketbaseClient.collection('ai_providers').getFirstListItem(
				pocketbaseClient.filter('code = {:code}', { code: raw.toLowerCase() }),
			);
		} catch {
			throw httpError(422, 'Provider does not exist', 'PROVIDER_NOT_FOUND');
		}
	}
}

async function findDuplicate(providerId, modelId, excludeId = '') {
	const filter = excludeId
		? pocketbaseClient.filter('provider = {:provider} && model_id = {:modelId} && id != {:excludeId}', {
			provider: providerId,
			modelId,
			excludeId,
		})
		: pocketbaseClient.filter('provider = {:provider} && model_id = {:modelId}', {
			provider: providerId,
			modelId,
		});
	try {
		return await pocketbaseClient.collection('ai_models').getFirstListItem(filter);
	} catch {
		return null;
	}
}

export async function ensureModelCatalogSeeded() {
	await ensureProviderCatalogSeeded();

	const providers = await pocketbaseClient.collection('ai_providers').getFullList({
		fields: 'id,code',
		requestKey: null,
	});
	const byCode = Object.fromEntries(providers.map((item) => [item.code, item]));

	const existing = await pocketbaseClient.collection('ai_models').getFullList({
		fields: 'id,provider,model_id',
		requestKey: null,
	}).catch(() => []);

	const existingKeys = new Set(existing.map((item) => `${item.provider}:${item.model_id}`));

	for (const seed of MODEL_SEED_CATALOG) {
		const provider = byCode[seed.providerCode];
		if (!provider) continue;
		const key = `${provider.id}:${seed.model_id}`;
		if (existingKeys.has(key)) continue;

		await pocketbaseClient.collection('ai_models').create({
			provider: provider.id,
			model_id: seed.model_id,
			display_name: seed.display_name,
			capability: seed.capability,
			capabilities: seed.capabilities,
			context_window: seed.context_window,
			input_pricing: seed.input_pricing ?? 0,
			output_pricing: seed.output_pricing ?? 0,
			pricing_unit: seed.pricing_unit || '1M',
			supports_vision: Boolean(seed.supports_vision),
			supports_streaming: Boolean(seed.supports_streaming),
			supports_function_calling: Boolean(seed.supports_function_calling),
			supports_reasoning: Boolean(seed.supports_reasoning),
			is_default: Boolean(seed.is_default),
			enabled: Boolean(seed.enabled),
			status: seed.enabled ? 'enabled' : 'disabled',
			priority: seed.priority ?? 100,
			version: seed.version || '',
			fallback_model_id: '',
			features: buildFeatures(seed),
			recommended: seed.recommended || [],
		});
	}
}

async function loadModel(id) {
	return pocketbaseClient.collection('ai_models').getOne(id, { expand: 'provider' });
}

export async function listModels(query = {}) {
	await ensureModelCatalogSeeded();

	const records = await pocketbaseClient.collection('ai_models').getFullList({
		sort: 'priority,display_name',
		expand: 'provider',
		requestKey: null,
	});

	let items = records.map((record) => mapModelDto(record, record.expand?.provider));

	const q = String(query.q || '').trim().toLowerCase();
	const provider = String(query.provider || '').trim();
	const status = String(query.status || '').trim();
	const capability = String(query.capability || '').trim().toLowerCase();

	if (provider) {
		items = items.filter((item) => (
			item.providerId === provider
			|| item.providerCode === provider
			|| item.provider === provider
		));
	}
	if (status) {
		items = items.filter((item) => item.status === status);
	}
	if (capability) {
		items = items.filter((item) => {
			const typeMatch = String(item.capability || '').toLowerCase() === capability;
			const tagMatch = (item.capabilities || []).some((tag) => String(tag).toLowerCase().includes(capability));
			return typeMatch || tagMatch;
		});
	}
	if (q) {
		items = items.filter((item) => {
			const haystack = [
				item.name,
				item.modelId,
				item.provider,
				item.capability,
				...(item.capabilities || []),
			].join(' ').toLowerCase();
			return haystack.includes(q);
		});
	}

	return {
		items,
		totalItems: items.length,
	};
}

export async function getModelById(id) {
	const record = await loadModel(id);
	return mapModelDto(record, record.expand?.provider);
}

function validatePayload(payload, { partial = false } = {}) {
	const modelId = payload.modelId ?? payload.model_id;
	const displayName = payload.displayName ?? payload.name ?? payload.display_name;
	const capability = payload.capability;

	if (!partial || modelId != null) {
		const id = String(modelId || '').trim();
		if (!id) throw httpError(422, 'modelId is required', 'VALIDATION_ERROR');
		if (id.length > 200) throw httpError(422, 'modelId is too long', 'VALIDATION_ERROR');
	}

	if (!partial || displayName != null) {
		const name = String(displayName || '').trim();
		if (!name) throw httpError(422, 'displayName is required', 'VALIDATION_ERROR');
	}

	if (capability != null && capability !== '' && !CAPABILITIES.has(String(capability))) {
		throw httpError(422, 'capability must be text, image, vision, or embedding', 'VALIDATION_ERROR');
	}

	if (payload.status != null && payload.status !== '' && !STATUSES.has(String(payload.status))) {
		throw httpError(422, 'status must be enabled, disabled, or deprecated', 'VALIDATION_ERROR');
	}

	return {
		modelId: modelId != null ? String(modelId).trim() : undefined,
		displayName: displayName != null ? String(displayName).trim() : undefined,
		capability: capability != null ? String(capability) : undefined,
		inputPricing: payload.inputPricing != null || payload.inputCost != null
			? parsePricing(payload.inputPricing ?? payload.inputCost, 'inputPricing')
			: undefined,
		outputPricing: payload.outputPricing != null || payload.outputCost != null
			? parsePricing(payload.outputPricing ?? payload.outputCost, 'outputPricing')
			: undefined,
	};
}

export async function createModel(payload = {}) {
	const provider = await getProviderByIdOrCode(payload.providerId || payload.provider || payload.providerCode);
	const validated = validatePayload(payload, { partial: false });

	const duplicate = await findDuplicate(provider.id, validated.modelId);
	if (duplicate) {
		throw httpError(409, `Model "${validated.modelId}" already exists for this provider`, 'CONFLICT');
	}

	const supportsVision = normalizeBool(payload.supportsVision, false);
	const supportsStreaming = normalizeBool(payload.supportsStreaming, true);
	const supportsFunctionCalling = normalizeBool(payload.supportsFunctionCalling, false);
	const supportsReasoning = normalizeBool(payload.supportsReasoning, false);
	const enabled = normalizeBool(payload.enabled, true);
	const isDefault = normalizeBool(payload.isDefault, false);
	const capability = validated.capability || 'text';
	const features = buildFeatures({
		supports_vision: supportsVision,
		supports_streaming: supportsStreaming,
		supports_function_calling: supportsFunctionCalling,
		supports_reasoning: supportsReasoning,
		features: payload.features,
	});

	if (isDefault) {
		await clearDefaultForCapability(capability, provider.id);
	}

	const record = await pocketbaseClient.collection('ai_models').create({
		provider: provider.id,
		model_id: validated.modelId,
		display_name: validated.displayName,
		capability,
		capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.map(String) : [],
		context_window: Number(payload.contextWindow) || 0,
		input_pricing: validated.inputPricing ?? 0,
		output_pricing: validated.outputPricing ?? 0,
		pricing_unit: payload.pricingUnit || '1M',
		supports_vision: supportsVision,
		supports_streaming: supportsStreaming,
		supports_function_calling: supportsFunctionCalling,
		supports_reasoning: supportsReasoning,
		is_default: isDefault,
		enabled,
		status: enabled ? 'enabled' : 'disabled',
		priority: Number.isFinite(Number(payload.priority)) ? Number(payload.priority) : 100,
		version: payload.version || '',
		fallback_model_id: payload.fallbackModelId || '',
		features,
		recommended: Array.isArray(payload.recommended) ? payload.recommended.map(String) : [],
	});

	return getModelById(record.id);
}

export async function updateModel(id, payload = {}) {
	const existing = await loadModel(id);
	const provider = payload.providerId || payload.provider || payload.providerCode
		? await getProviderByIdOrCode(payload.providerId || payload.provider || payload.providerCode)
		: await getProviderByIdOrCode(existing.provider);

	const validated = validatePayload({
		modelId: payload.modelId ?? existing.model_id,
		displayName: payload.displayName ?? payload.name ?? existing.display_name,
		capability: payload.capability ?? existing.capability,
		inputPricing: payload.inputPricing ?? payload.inputCost,
		outputPricing: payload.outputPricing ?? payload.outputCost,
		status: payload.status,
	}, { partial: true });

	const nextModelId = validated.modelId || existing.model_id;
	const duplicate = await findDuplicate(provider.id, nextModelId, id);
	if (duplicate) {
		throw httpError(409, `Model "${nextModelId}" already exists for this provider`, 'CONFLICT');
	}

	const supportsVision = payload.supportsVision != null ? normalizeBool(payload.supportsVision) : Boolean(existing.supports_vision);
	const supportsStreaming = payload.supportsStreaming != null ? normalizeBool(payload.supportsStreaming) : Boolean(existing.supports_streaming);
	const supportsFunctionCalling = payload.supportsFunctionCalling != null ? normalizeBool(payload.supportsFunctionCalling) : Boolean(existing.supports_function_calling);
	const supportsReasoning = payload.supportsReasoning != null ? normalizeBool(payload.supportsReasoning) : Boolean(existing.supports_reasoning);
	const enabled = payload.enabled != null
		? normalizeBool(payload.enabled)
		: (payload.status ? payload.status === 'enabled' : existing.enabled !== false);
	const capability = validated.capability || existing.capability || 'text';
	const isDefault = payload.isDefault != null ? normalizeBool(payload.isDefault) : Boolean(existing.is_default);

	if (isDefault) {
		await clearDefaultForCapability(capability, provider.id, id);
	}

	await pocketbaseClient.collection('ai_models').update(id, {
		provider: provider.id,
		model_id: nextModelId,
		display_name: validated.displayName || existing.display_name,
		capability,
		capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.map(String) : existing.capabilities,
		context_window: payload.contextWindow != null ? Number(payload.contextWindow) || 0 : existing.context_window,
		input_pricing: validated.inputPricing != null ? validated.inputPricing : existing.input_pricing,
		output_pricing: validated.outputPricing != null ? validated.outputPricing : existing.output_pricing,
		pricing_unit: payload.pricingUnit || existing.pricing_unit || '1M',
		supports_vision: supportsVision,
		supports_streaming: supportsStreaming,
		supports_function_calling: supportsFunctionCalling,
		supports_reasoning: supportsReasoning,
		is_default: isDefault,
		enabled,
		status: payload.status || (enabled ? 'enabled' : 'disabled'),
		priority: payload.priority != null && Number.isFinite(Number(payload.priority))
			? Number(payload.priority)
			: existing.priority,
		version: payload.version != null ? String(payload.version) : existing.version,
		fallback_model_id: payload.fallbackModelId != null ? String(payload.fallbackModelId) : existing.fallback_model_id,
		features: Array.isArray(payload.features)
			? buildFeatures({
				supports_vision: supportsVision,
				supports_streaming: supportsStreaming,
				supports_function_calling: supportsFunctionCalling,
				supports_reasoning: supportsReasoning,
				features: payload.features,
			})
			: buildFeatures({
				supports_vision: supportsVision,
				supports_streaming: supportsStreaming,
				supports_function_calling: supportsFunctionCalling,
				supports_reasoning: supportsReasoning,
				features: existing.features,
			}),
		recommended: Array.isArray(payload.recommended) ? payload.recommended.map(String) : existing.recommended,
	});

	return getModelById(id);
}

async function clearDefaultForCapability(capability, _providerId, excludeId = '') {
	const records = await pocketbaseClient.collection('ai_models').getFullList({
		filter: pocketbaseClient.filter('capability = {:capability} && is_default = true', { capability }),
		requestKey: null,
	});

	await Promise.all(records
		.filter((item) => item.id !== excludeId)
		.map((item) => pocketbaseClient.collection('ai_models').update(item.id, { is_default: false })));
}

export async function setModelEnabled(id, enabled) {
	await loadModel(id);
	await pocketbaseClient.collection('ai_models').update(id, {
		enabled: Boolean(enabled),
		status: enabled ? 'enabled' : 'disabled',
		...(enabled ? {} : { is_default: false }),
	});
	return getModelById(id);
}

export async function setModelDefault(id) {
	const existing = await loadModel(id);
	await clearDefaultForCapability(existing.capability || 'text', existing.provider, id);
	await pocketbaseClient.collection('ai_models').update(id, {
		is_default: true,
		enabled: true,
		status: 'enabled',
	});
	return getModelById(id);
}

export async function deleteModel(id) {
	await pocketbaseClient.collection('ai_models').getOne(id);
	await pocketbaseClient.collection('ai_models').delete(id);
	return { ok: true, id };
}
