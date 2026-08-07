/**
 * Gallery API client — marketplace-ready query surface.
 */

import apiServerClient from '@/lib/apiServerClient';

function toQuery(params = {}) {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value == null || value === '') continue;
		if (value === false) continue;
		search.set(key, String(value));
	}
	return search.toString();
}

function apiError(payload, fallback) {
	const error = new Error(payload?.message || fallback);
	if (payload?.errorCode) error.errorCode = payload.errorCode;
	if (payload?.access) error.access = payload.access;
	if (Array.isArray(payload?.requiredKeys)) error.requiredKeys = payload.requiredKeys;
	if (payload?.featureKey) error.featureKey = payload.featureKey;
	return error;
}

export async function fetchGalleryPage(filters = {}) {
	const query = toQuery({
		view: 'gallery',
		page: filters.page || 1,
		perPage: filters.perPage || 24,
		q: filters.q || '',
		category: filters.category || '',
		status: filters.status || '',
		visibility: filters.visibility || '',
		scope: filters.scope || '',
		library: filters.library || '',
		sort: filters.sort || 'recently_updated',
		favorite: filters.favorite ? '1' : '',
		recentlyUsed: filters.recentlyUsed ? '1' : '',
		tag: filters.tag || '',
		channel: filters.channel || '',
		includeArchived: filters.includeArchived ? '1' : '',
	});
	const response = await apiServerClient.fetch(`/workspace/v1/templates?${query}`, { method: 'GET' });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw apiError(payload, 'Failed to load gallery');
	}
	return payload;
}

export async function fetchTemplate(id) {
	const response = await apiServerClient.fetch(`/workspace/v1/templates/${id}`, { method: 'GET' });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) throw apiError(payload, 'Template not found');
	return payload.item || payload;
}

export async function duplicateTemplate(id) {
	const response = await apiServerClient.fetch(`/workspace/v1/templates/${id}/duplicate`, { method: 'POST' });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) throw apiError(payload, 'Duplicate failed');
	return payload;
}

export async function deleteTemplate(id) {
	const response = await apiServerClient.fetch(`/workspace/v1/templates/${id}`, { method: 'DELETE' });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) throw apiError(payload, 'Delete failed');
	return payload;
}

export async function renameTemplate(id, name) {
	const response = await apiServerClient.fetch(`/workspace/v1/templates/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name }),
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) throw apiError(payload, 'Rename failed');
	return payload;
}

export async function favoriteTemplate(id) {
	const response = await apiServerClient.fetch(`/workspace/v1/templates/${id}/favorite`, { method: 'POST' });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) throw apiError(payload, 'Favorite failed');
	return payload;
}

export async function setTemplateStatus(id, status) {
	const response = await apiServerClient.fetch(`/workspace/v1/templates/${id}/status`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ status }),
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) throw apiError(payload, 'Status update failed');
	return payload;
}

export async function touchTemplate(id) {
	const response = await apiServerClient.fetch(`/workspace/v1/templates/${id}/touch`, { method: 'POST' });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) throw apiError(payload, 'Touch failed');
	return payload;
}

export async function exportTemplate(id) {
	const response = await apiServerClient.fetch(`/workspace/v1/templates/${id}/export`, { method: 'GET' });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) throw apiError(payload, 'Export failed');
	return payload;
}

export async function bulkTemplateAction(action, ids) {
	const response = await apiServerClient.fetch('/workspace/v1/templates/bulk', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action, ids }),
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) throw apiError(payload, 'Bulk action failed');
	return payload;
}

export async function createGalleryTemplate(body) {
	const response = await apiServerClient.fetch('/workspace/v1/templates', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) throw apiError(payload, 'Create failed');
	return payload;
}

export async function lookupPreviewCache({ templateId, configChecksum, format = 'png' }) {
	const query = toQuery({ templateId, configChecksum, format });
	const response = await apiServerClient.fetch(`/workspace/v1/templates/preview-cache?${query}`, { method: 'GET' });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) return { hit: false };
	return payload;
}
