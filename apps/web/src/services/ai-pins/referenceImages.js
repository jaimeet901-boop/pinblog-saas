import apiServerClient from '@/lib/apiServerClient';

async function readJson(response) {
	return response.json().catch(() => ({}));
}

export async function listReferenceImages() {
	const response = await apiServerClient.fetch('/ai-pins/reference-images', { method: 'GET' });
	const payload = await readJson(response);
	if (!response.ok) {
		throw new Error(payload?.message || `Failed to load reference images (${response.status})`);
	}
	return Array.isArray(payload.items) ? payload.items : [];
}

export async function uploadReferenceImages(files) {
	const list = Array.from(files || []).filter(Boolean);
	if (list.length === 0) {
		return [];
	}

	const formData = new FormData();
	list.forEach((file) => {
		formData.append('images', file);
	});

	const response = await apiServerClient.fetch('/ai-pins/reference-images', {
		method: 'POST',
		body: formData,
	});
	const payload = await readJson(response);
	if (!response.ok) {
		throw new Error(payload?.message || `Failed to upload reference images (${response.status})`);
	}
	return Array.isArray(payload.items) ? payload.items : [];
}

export async function deleteReferenceImage(id) {
	const response = await apiServerClient.fetch(`/ai-pins/reference-images/${encodeURIComponent(id)}`, {
		method: 'DELETE',
	});
	if (!response.ok && response.status !== 204) {
		const payload = await readJson(response);
		throw new Error(payload?.message || `Failed to delete reference image (${response.status})`);
	}
}
