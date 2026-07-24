/**
 * DraftService — save drafts, duplicate, update draft fields via PB + editor API.
 */

import pb from '@/lib/pocketbaseClient';
import apiServerClient from '@/lib/apiServerClient';

function safeArray(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
	if (typeof value === 'string') {
		return value.split(',').map((item) => item.trim()).filter(Boolean);
	}
	return [];
}

export function mapSavedPin(pin) {
	return {
		id: pin.id,
		articleId: pin.articleId,
		websiteId: pin.websiteId,
		title: pin.title,
		description: pin.description,
		overlayText: pin.overlay_text,
		imagePrompt: pin.image_prompt,
		imageUrl: pin.image_url || '',
		suggestedKeywords: safeArray(pin.suggested_keywords),
		suggestedHashtags: safeArray(pin.suggested_hashtags),
		status: pin.status,
		accountId: pin.pinterest_account_id || '',
		accountLabel: pin.pinterest_account_label || '',
		scheduledAt: pin.scheduled_at || '',
		scheduledTimezone: pin.scheduled_timezone || '',
		boardId: pin.pinterest_board_id || '',
		boardName: pin.pinterest_board_name || '',
		pinterestPinUrl: pin.pinterest_pin_url || '',
		publishError: pin.publish_error || '',
		publishJobId: pin.publish_job_id || '',
		targetAudience: pin.target_audience,
		toneOfVoice: pin.tone_of_voice,
		language: pin.language,
		created: pin.created,
		updated: pin.updated,
	};
}

/**
 * Persist generated preview pins as drafts.
 */
export async function saveDrafts({ previewPins, panel }) {
	const records = [];
	for (const pin of previewPins) {
		const payload = {
			owner: pb.authStore.record.id,
			articleId: pin.articleId,
			websiteId: pin.websiteId,
			image_prompt: String(pin.imagePrompt || '').trim(),
			overlay_text: String(pin.overlayText || '').trim(),
			title: String(pin.title || 'Draft AI Pin').trim(),
			description: String(pin.description || '').trim(),
			image_url: String(pin.imageUrl || '').trim(),
			pinterest_account_id: String(pin.accountId || '').trim(),
			pinterest_account_label: String(pin.accountLabel || '').trim(),
			pinterest_board_id: String(pin.boardId || '').trim(),
			pinterest_board_name: String(pin.boardName || '').trim(),
			suggested_keywords: safeArray(pin.suggestedKeywords),
			suggested_hashtags: safeArray(pin.suggestedHashtags),
			target_audience: panel?.targetAudience || '',
			tone_of_voice: panel?.toneOfVoice || '',
			language: panel?.language || '',
			status: 'draft',
			image_source: String(pin.imageSource || '').trim() || 'featured',
			image_generation_status: String(pin.imageGenerationStatus || '').trim() || 'idle',
			image_generation_error: String(pin.imageGenerationError || '').trim(),
		};
		const created = await pb.collection('ai_pins').create(payload);
		records.push(mapSavedPin(created));
	}
	return records;
}

/**
 * Duplicate an existing pin as a new draft (one click).
 */
export async function duplicatePin(pin, { titleSuffix = ' (Copy)' } = {}) {
	if (!pin?.id && !pin?.title) {
		throw new Error('Nothing to duplicate');
	}

	const source = pin.id
		? await pb.collection('ai_pins').getOne(pin.id)
		: null;

	const base = source || {};
	const payload = {
		owner: pb.authStore.record.id,
		articleId: base.articleId || pin.articleId || '',
		websiteId: base.websiteId || pin.websiteId || '',
		image_prompt: base.image_prompt || pin.imagePrompt || '',
		overlay_text: base.overlay_text || pin.overlayText || '',
		title: `${(base.title || pin.title || 'AI Pin').trim()}${titleSuffix}`.slice(0, 200),
		description: base.description || pin.description || '',
		image_url: base.image_url || pin.imageUrl || '',
		pinterest_account_id: base.pinterest_account_id || pin.accountId || '',
		pinterest_account_label: base.pinterest_account_label || pin.accountLabel || '',
		pinterest_board_id: base.pinterest_board_id || pin.boardId || '',
		pinterest_board_name: base.pinterest_board_name || pin.boardName || '',
		suggested_keywords: safeArray(base.suggested_keywords || pin.suggestedKeywords),
		suggested_hashtags: safeArray(base.suggested_hashtags || pin.suggestedHashtags),
		target_audience: base.target_audience || pin.targetAudience || '',
		tone_of_voice: base.tone_of_voice || pin.toneOfVoice || '',
		language: base.language || pin.language || '',
		status: 'draft',
		image_source: base.image_source || 'featured',
		image_generation_status: 'idle',
		image_generation_error: '',
		cta: base.cta || '',
		style: base.style || '',
		analysis: base.analysis || null,
		editor_state: base.editor_state || null,
	};

	const created = await pb.collection('ai_pins').create(payload);
	return mapSavedPin(created);
}

/**
 * Duplicate one pin into N draft copies (for recurrence series).
 */
export async function duplicatePinMany(pin, count) {
	const copies = [];
	for (let i = 0; i < count; i += 1) {
		copies.push(await duplicatePin(pin, { titleSuffix: count > 1 ? ` (${i + 1})` : ' (Copy)' }));
	}
	return copies;
}

/**
 * Save editor fields + account/board targets.
 */
export async function updateDraftPin({
	pin,
	accounts = [],
	boards = [],
	analysis = null,
	panel = {},
}) {
	const selectedAccount = accounts.find((account) => account.id === pin.accountId);
	const selectedBoard = boards.find((board) => board.boardId === pin.boardId);

	const editorResponse = await apiServerClient.fetch(`/ai-pins/pins/${pin.id}/editor`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			title: pin.title,
			description: pin.description,
			overlayText: pin.overlayText,
			imagePrompt: pin.imagePrompt,
			imageUrl: pin.imageUrl,
			cta: pin.cta || analysis?.cta || '',
			style: pin.style || panel.style,
			analysis: pin.analysis || analysis,
			editorState: {
				crop: pin.editorCrop || null,
				resize: pin.editorResize || { width: 1000, height: 1500 },
				overlays: pin.editorOverlays || [],
			},
			suggestedKeywords: safeArray(pin.suggestedKeywords),
			suggestedHashtags: safeArray(pin.suggestedHashtags),
		}),
	});
	const editorPayload = await editorResponse.json().catch(() => ({}));
	if (!editorResponse.ok) {
		throw new Error(editorPayload?.message || 'Failed to save pin editor changes');
	}

	const updated = await pb.collection('ai_pins').update(pin.id, {
		pinterest_account_id: pin.accountId || '',
		pinterest_account_label: pin.accountId
			? (selectedAccount?.label || selectedAccount?.accountName || selectedAccount?.username || '')
			: '',
		pinterest_board_id: pin.boardId || '',
		pinterest_board_name: selectedBoard?.name || pin.boardName || '',
		scheduled_at: pin.scheduledAt || '',
		scheduled_timezone: pin.scheduledTimezone || '',
	}).catch(() => null);

	// Keep Calendar in sync: scheduled jobs are the calendar source of truth.
	const jobId = pin.publishJobId || updated?.publish_job_id || '';
	if (jobId && (pin.status === 'scheduled' || updated?.status === 'scheduled')) {
		const jobPayload = {};
		if (pin.scheduledAt) jobPayload.scheduledAt = pin.scheduledAt;
		if (pin.scheduledTimezone) jobPayload.timezone = pin.scheduledTimezone;
		if (pin.accountId) jobPayload.accountId = pin.accountId;
		if (pin.boardId) jobPayload.boardId = pin.boardId;
		if (Object.keys(jobPayload).length > 0) {
			const jobResponse = await apiServerClient.fetch(`/pinterest/jobs/${jobId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(jobPayload),
			});
			if (!jobResponse.ok) {
				const jobBody = await jobResponse.json().catch(() => ({}));
				throw new Error(jobBody?.message || 'Pin saved, but Calendar schedule update failed');
			}
		}
	}

	return {
		...pin,
		...(updated ? mapSavedPin(updated) : {}),
		title: editorPayload.title || pin.title,
		description: editorPayload.description || pin.description,
		overlayText: editorPayload.overlayText || pin.overlayText,
		imagePrompt: editorPayload.imagePrompt || pin.imagePrompt,
		imageUrl: editorPayload.imageUrl || pin.imageUrl,
		cta: editorPayload.cta || '',
		style: editorPayload.style || panel.style,
		analysis: editorPayload.analysis || analysis,
	};
}

export async function deleteDraftPin(pinId) {
	await pb.collection('ai_pins').delete(pinId);
}
