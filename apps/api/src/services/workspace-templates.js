import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { assertCapability } from './workspace-rbac.js';
import { assertSameWorkspace } from './workspace-context.js';

function mapPinTemplate(record) {
	return {
		id: record.id,
		name: record.name,
		thumbnail: record.thumbnail || '',
		configuration: record.configuration || {},
		isDefault: Boolean(record.is_default),
		category: 'pin',
		source: 'ai_pin_templates',
		createdAt: record.created,
		updatedAt: record.updated,
	};
}

function mapCatalogTemplate(record) {
	return {
		id: record.id,
		name: record.name,
		description: record.description || '',
		category: record.category || 'custom',
		content: record.content || {},
		isDefault: Boolean(record.is_default),
		active: record.active !== false,
		source: 'templates',
		createdAt: record.created,
		updatedAt: record.updated,
	};
}

async function clearPinDefaults(ownerId, exceptId = '') {
	const templates = await pocketbaseClient.collection('ai_pin_templates').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		requestKey: null,
	});
	await Promise.all(
		templates
			.filter((template) => template.id !== exceptId && template.is_default)
			.map((template) => pocketbaseClient.collection('ai_pin_templates').update(template.id, { is_default: false })),
	);
}

export async function listWorkspaceTemplates(req, query = {}) {
	assertCapability(req, 'workspace.read');
	const ownerId = req.pocketbaseUserId;
	const category = String(query.category || '').trim();

	const [pinTemplates, catalog] = await Promise.all([
		pocketbaseClient.collection('ai_pin_templates').getFullList({
			filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
			sort: '-is_default,-updated',
			requestKey: null,
		}).catch(() => []),
		pocketbaseClient.collection('templates').getFullList({
			filter: pocketbaseClient.filter('workspace = {:ws}', { ws: req.workspace.id }),
			sort: '-is_default,-updated',
			requestKey: null,
		}).catch(() => []),
	]);

	let items = [
		...pinTemplates.map(mapPinTemplate),
		...catalog.map(mapCatalogTemplate),
	];

	if (category === 'pin') {
		items = items.filter((item) => item.source === 'ai_pin_templates' || item.category === 'pin');
	} else if (category) {
		items = items.filter((item) => item.category === category);
	}

	return { items, totalItems: items.length };
}

export async function createPinTemplate(req, payload = {}) {
	assertCapability(req, 'workspace.templates.manage');
	const name = String(payload.name || '').trim();
	if (!name) throw httpError(422, 'name is required', 'VALIDATION_ERROR');

	const isDefault = Boolean(payload.isDefault ?? payload.is_default);
	if (isDefault) {
		await clearPinDefaults(req.pocketbaseUserId);
	}

	const created = await pocketbaseClient.collection('ai_pin_templates').create({
		owner: req.pocketbaseUserId,
		name,
		thumbnail: payload.thumbnail || '',
		configuration: payload.configuration || {},
		is_default: isDefault,
	});

	return mapPinTemplate(created);
}

export async function updatePinTemplate(req, id, payload = {}) {
	assertCapability(req, 'workspace.templates.manage');
	const existing = await pocketbaseClient.collection('ai_pin_templates').getOne(id).catch(() => null);
	if (!existing || existing.owner !== req.pocketbaseUserId) {
		throw httpError(404, 'Template not found', 'NOT_FOUND');
	}

	const updates = {};
	if (payload.name != null) {
		const name = String(payload.name).trim();
		if (!name) throw httpError(422, 'name is required', 'VALIDATION_ERROR');
		updates.name = name;
	}
	if (payload.thumbnail != null) updates.thumbnail = payload.thumbnail;
	if (payload.configuration != null) updates.configuration = payload.configuration;
	if (payload.isDefault != null || payload.is_default != null) {
		const isDefault = Boolean(payload.isDefault ?? payload.is_default);
		updates.is_default = isDefault;
		if (isDefault) await clearPinDefaults(req.pocketbaseUserId, id);
	}

	const updated = await pocketbaseClient.collection('ai_pin_templates').update(id, updates);
	return mapPinTemplate(updated);
}

export async function deletePinTemplate(req, id) {
	assertCapability(req, 'workspace.templates.manage');
	const existing = await pocketbaseClient.collection('ai_pin_templates').getOne(id).catch(() => null);
	if (!existing || existing.owner !== req.pocketbaseUserId) {
		throw httpError(404, 'Template not found', 'NOT_FOUND');
	}
	await pocketbaseClient.collection('ai_pin_templates').delete(id);
	return { ok: true, id };
}

export async function duplicatePinTemplate(req, id) {
	assertCapability(req, 'workspace.templates.manage');
	const existing = await pocketbaseClient.collection('ai_pin_templates').getOne(id).catch(() => null);
	if (!existing || existing.owner !== req.pocketbaseUserId) {
		throw httpError(404, 'Template not found', 'NOT_FOUND');
	}
	const created = await pocketbaseClient.collection('ai_pin_templates').create({
		owner: req.pocketbaseUserId,
		name: `${existing.name} Copy`,
		thumbnail: existing.thumbnail || '',
		configuration: existing.configuration || {},
		is_default: false,
	});
	return mapPinTemplate(created);
}

export async function createCatalogTemplate(req, payload = {}) {
	assertCapability(req, 'workspace.templates.manage');
	const name = String(payload.name || '').trim();
	if (!name) throw httpError(422, 'name is required', 'VALIDATION_ERROR');
	const category = payload.category || 'custom';
	const allowed = ['prompt', 'recipe', 'seo', 'pin', 'custom'];
	if (!allowed.includes(category)) {
		throw httpError(422, 'invalid category', 'VALIDATION_ERROR');
	}

	const created = await pocketbaseClient.collection('templates').create({
		workspace: req.workspace.id,
		owner: req.pocketbaseUserId,
		name,
		category,
		description: String(payload.description || '').slice(0, 1000),
		content: payload.content || {},
		is_default: Boolean(payload.isDefault),
		active: payload.active !== false,
	});
	return mapCatalogTemplate(created);
}

export async function updateCatalogTemplate(req, id, payload = {}) {
	assertCapability(req, 'workspace.templates.manage');
	const existing = await pocketbaseClient.collection('templates').getOne(id).catch(() => null);
	if (!existing) throw httpError(404, 'Template not found', 'NOT_FOUND');
	assertSameWorkspace(existing.workspace, req.workspace.id);

	const updates = {};
	if (payload.name != null) updates.name = String(payload.name).trim();
	if (payload.description != null) updates.description = String(payload.description).slice(0, 1000);
	if (payload.category != null) updates.category = payload.category;
	if (payload.content != null) updates.content = payload.content;
	if (payload.isDefault != null) updates.is_default = Boolean(payload.isDefault);
	if (payload.active != null) updates.active = Boolean(payload.active);

	const updated = await pocketbaseClient.collection('templates').update(id, updates);
	return mapCatalogTemplate(updated);
}

export async function deleteCatalogTemplate(req, id) {
	assertCapability(req, 'workspace.templates.manage');
	const existing = await pocketbaseClient.collection('templates').getOne(id).catch(() => null);
	if (!existing) throw httpError(404, 'Template not found', 'NOT_FOUND');
	assertSameWorkspace(existing.workspace, req.workspace.id);
	await pocketbaseClient.collection('templates').delete(id);
	return { ok: true, id };
}
