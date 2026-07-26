/**
 * DraftService — save drafts, duplicate, update draft fields via PB + editor API.
 */

import pb from '@/lib/pocketbaseClient';
import apiServerClient from '@/lib/apiServerClient';
import {
	assertPersistableImageUrl,
	ensureHostedImageForPin,
	ensurePinsReadyForSave,
	isPersistableImageUrl,
} from './imageLifecycle.js';
import {
	mapTemplateSnapshotFromRecord,
	toTemplateEditorPatch,
	toTemplateSnapshotPayload,
} from './templateSnapshot.js';
import {
	normalizeDestinationUrl,
	normalizeImageOrigin,
	resolvePinDestinationUrl,
} from '@/lib/pinPublishDestination.js';
import { traceSourceUrl } from './sourceUrlTrace.js';

const IMAGE_SOURCE_VALUES = new Set([
	'featured',
	'ai_generated',
	'featured_fallback',
	'featured_composed',
]);

const IMAGE_GENERATION_STATUS_VALUES = new Set([
	'idle',
	'queued',
	'processing',
	'completed',
	'failed',
	'fallback',
	'rendering',
]);

function safeArray(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
	if (typeof value === 'string') {
		return value.split(',').map((item) => item.trim()).filter(Boolean);
	}
	return [];
}

function truncateText(value, max) {
	const text = String(value || '');
	if (text.length <= max) return text;
	return text.slice(0, max);
}

/**
 * Extract the real PocketBase validation / API error instead of the generic
 * "Failed to create record" message.
 */
export function formatPocketBaseError(error, fallback = 'Failed to save pin') {
	if (!error) return fallback;

	const responseData = error?.response || error?.data || {};
	const fieldErrors = responseData?.data && typeof responseData.data === 'object'
		? responseData.data
		: (error?.data && typeof error.data === 'object' ? error.data : null);

	const fieldMessages = [];
	if (fieldErrors) {
		Object.entries(fieldErrors).forEach(([field, detail]) => {
			if (!detail) return;
			if (typeof detail === 'string') {
				fieldMessages.push(`${field}: ${detail}`);
				return;
			}
			const message = detail.message || detail.code || JSON.stringify(detail);
			fieldMessages.push(`${field}: ${message}`);
		});
	}

	const topMessage = String(
		responseData?.message
		|| error?.message
		|| fallback,
	).trim();

	if (fieldMessages.length > 0) {
		const joined = fieldMessages.join(' · ');
		if (topMessage && !fieldMessages.some((item) => item.includes(topMessage))) {
			return `${topMessage} — ${joined}`;
		}
		return joined;
	}

	if (error?.status) {
		return `${topMessage} (HTTP ${error.status})`;
	}
	return topMessage || fallback;
}

function normalizeImageSource(value) {
	const raw = String(value || '').trim();
	if (IMAGE_SOURCE_VALUES.has(raw)) return raw;
	if (raw === 'composed' || raw === 'canvas') return 'featured_composed';
	return 'featured';
}

function normalizeImageGenerationStatus(value) {
	const raw = String(value || '').trim();
	if (IMAGE_GENERATION_STATUS_VALUES.has(raw)) return raw;
	if (raw === 'done' || raw === 'success') return 'completed';
	if (raw === 'error') return 'failed';
	if (raw === 'pending' || raw === 'running') return 'processing';
	return 'idle';
}

function normalizeImageUrl(value) {
	const url = String(value || '').trim();
	if (!url) return '';
	// Blob URLs are browser-local — callers must upload via imageLifecycle first.
	if (url.startsWith('blob:')) return '';
	if (!/^https?:\/\//i.test(url)) return '';
	return truncateText(url, 4000);
}

export function mapSavedPin(pin) {
	const templateSnapshot = mapTemplateSnapshotFromRecord(pin);
	const sourceUrl = resolvePinDestinationUrl(pin);
	traceSourceUrl('4_api_response_mapSavedPin', {
		sourceUrl,
		source_url: pin.source_url,
		pinId: pin.id,
		articleId: pin.articleId,
		file: 'apps/web/src/services/ai-pins/draftService.js',
		functionName: 'mapSavedPin',
		lineNumber: 128,
		meta: { rawSourceUrl: pin.source_url || null },
	});
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
		imageSource: pin.image_source || '',
		imageOrigin: normalizeImageOrigin(pin.image_origin, { imageSource: pin.image_source }),
		sourceUrl,
		articleUrl: sourceUrl,
		destinationUrl: sourceUrl,
		imageGenerationStatus: pin.image_generation_status || '',
		created: pin.created,
		updated: pin.updated,
		...templateSnapshot,
	};
}

function buildDraftPayload(pin, panel) {
	const ownerId = pb.authStore?.record?.id;
	if (!ownerId) {
		throw new Error('You must be signed in to save pins');
	}

	const articleId = String(pin.articleId || '').trim();
	const websiteId = String(pin.websiteId || '').trim();
	if (!articleId) {
		throw new Error('Cannot save pin: articleId is missing (required relation)');
	}
	if (!websiteId) {
		throw new Error('Cannot save pin: websiteId is missing (required relation)');
	}

	const imageUrl = assertPersistableImageUrl(pin.imageUrl, pin.title || pin.tempId || 'Pin');
	const sourceUrl = normalizeDestinationUrl(
		pin.sourceUrl || pin.articleUrl || pin.destinationUrl || '',
	);
	if (!sourceUrl) {
		throw new Error(
			`Cannot save pin "${pin.title || pin.tempId || pin.id}": source_url (original article URL) is required`,
		);
	}
	const imageOrigin = normalizeImageOrigin(pin.imageOrigin, { imageSource: pin.imageSource });

	traceSourceUrl('3_database_save_payload', {
		sourceUrl,
		tempId: pin.tempId,
		pinId: pin.id,
		articleId,
		file: 'apps/web/src/services/ai-pins/draftService.js',
		functionName: 'buildDraftPayload',
		lineNumber: 195,
	});

	return {
		owner: ownerId,
		articleId,
		websiteId,
		image_prompt: truncateText(pin.imagePrompt || '', 4000),
		overlay_text: truncateText(pin.overlayText || '', 600),
		title: truncateText(pin.title || 'Draft AI Pin', 300) || 'Draft AI Pin',
		description: truncateText(pin.description || '', 2000),
		image_url: normalizeImageUrl(imageUrl),
		source_url: truncateText(sourceUrl, 2000),
		image_origin: truncateText(imageOrigin, 32),
		pinterest_account_id: truncateText(pin.accountId || '', 80),
		pinterest_account_label: truncateText(pin.accountLabel || '', 255),
		pinterest_board_id: truncateText(pin.boardId || '', 120),
		pinterest_board_name: truncateText(pin.boardName || '', 300),
		suggested_keywords: safeArray(pin.suggestedKeywords),
		suggested_hashtags: safeArray(pin.suggestedHashtags),
		target_audience: truncateText(panel?.targetAudience || '', 200),
		tone_of_voice: truncateText(panel?.toneOfVoice || '', 100),
		language: truncateText(panel?.language || '', 60),
		status: 'draft',
		image_source: normalizeImageSource(pin.imageSource),
		image_generation_status: normalizeImageGenerationStatus(
			pin.imageGenerationStatus || 'completed',
		),
		image_generation_error: truncateText(pin.imageGenerationError || '', 3000),
		cta: truncateText(pin.cta || '', 300),
		style: truncateText(pin.style || '', 64),
		...(pin.brandKitId ? { brand_kit: String(pin.brandKitId).trim() } : {}),
		...(pin.analysis ? { analysis: pin.analysis } : {}),
		...toTemplateSnapshotPayload(pin),
	};
}

/**
 * Persist generated preview pins as drafts.
 * Never writes empty image_url — uploads blob previews first when needed.
 */
export async function saveDrafts({ previewPins, panel }) {
	const pins = Array.isArray(previewPins) ? previewPins : [];
	if (pins.length === 0) {
		throw new Error('No pins to save');
	}

	let readyPins;
	try {
		readyPins = await ensurePinsReadyForSave(pins);
	} catch (error) {
		throw new Error(error?.message || 'Save Draft blocked until a hosted image URL is ready');
	}

	const records = [];
	for (const pin of readyPins) {
		const pinLabel = String(pin?.title || pin?.tempId || 'pin').slice(0, 80);
		try {
			const payload = buildDraftPayload(pin, panel);
			if (!isPersistableImageUrl(payload.image_url)) {
				throw new Error('Refusing to save draft with empty image_url');
			}
			let created;
			try {
				created = await pb.collection('ai_pins').create(payload);
			} catch (firstError) {
				const detail = formatPocketBaseError(firstError);
				if (/source_url/i.test(detail)) {
					throw new Error(
						`Save failed for "${pinLabel}": source_url was rejected by PocketBase (${detail}). `
						+ 'Apply migration 1783986000_ai_pins_source_url and retry — destination URL must persist.',
					);
				}
				if (/image_origin/i.test(detail)) {
					throw new Error(
						`Save failed for "${pinLabel}": image_origin was rejected by PocketBase (${detail}). `
						+ 'Apply migration 1783986000_ai_pins_source_url and retry.',
					);
				}
				const imageSourceRejected = /image_source/i.test(detail)
					&& payload.image_source === 'featured_composed';
				const statusRejected = /image_generation_status/i.test(detail)
					&& payload.image_generation_status === 'rendering';
				if (!imageSourceRejected && !statusRejected) {
					throw firstError;
				}
				// Remap legacy select values only — never drop source_url.
				const retryPayload = { ...payload };
				if (imageSourceRejected) retryPayload.image_source = 'featured';
				if (statusRejected) retryPayload.image_generation_status = 'processing';
				created = await pb.collection('ai_pins').create(retryPayload);
			}
			traceSourceUrl('3_database_save_record', {
				sourceUrl: created?.source_url,
				pinId: created?.id,
				articleId: created?.articleId,
				file: 'apps/web/src/services/ai-pins/draftService.js',
				functionName: 'saveDrafts',
				lineNumber: 268,
			});
			const mapped = mapSavedPin(created);
			if (!isPersistableImageUrl(mapped.imageUrl)) {
				throw new Error('Draft was created without a persisted image_url — contact support');
			}
			if (!mapped.sourceUrl) {
				throw new Error(
					`Draft "${pinLabel}" was created without source_url. Refusing to keep a pin that cannot be published.`,
				);
			}
			traceSourceUrl('5_react_state_after_save', {
				sourceUrl: mapped.sourceUrl,
				pinId: mapped.id,
				articleId: mapped.articleId,
				file: 'apps/web/src/services/ai-pins/draftService.js',
				functionName: 'saveDrafts',
				lineNumber: 280,
			});
			records.push(mapped);
		} catch (error) {
			const detail = formatPocketBaseError(error, error?.message || 'Failed to create record');
			throw new Error(`Save failed for "${pinLabel}": ${detail}`);
		}
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
	try {
		const fromRecord = mapTemplateSnapshotFromRecord(base);
		const fromPin = mapTemplateSnapshotFromRecord(pin);
		const sourceSnapshot = {
			templateId: fromPin.templateId || fromRecord.templateId,
			templateName: fromPin.templateName || fromRecord.templateName,
			templateVersion: fromPin.templateVersion || fromRecord.templateVersion,
			templateConfig: fromPin.templateConfig || fromRecord.templateConfig,
			templateConfiguration: fromPin.templateConfiguration || fromRecord.templateConfiguration,
			templateThumbnail: fromPin.templateThumbnail || fromRecord.templateThumbnail,
			templateSnapshotAt: fromPin.templateSnapshotAt || fromRecord.templateSnapshotAt,
		};
		const payload = buildDraftPayload({
			articleId: base.articleId || pin.articleId || '',
			websiteId: base.websiteId || pin.websiteId || '',
			imagePrompt: base.image_prompt || pin.imagePrompt || '',
			overlayText: base.overlay_text || pin.overlayText || '',
			title: `${(base.title || pin.title || 'AI Pin').trim()}${titleSuffix}`.slice(0, 200),
			description: base.description || pin.description || '',
			imageUrl: base.image_url || pin.imageUrl || '',
			sourceUrl: base.source_url || pin.sourceUrl || pin.articleUrl || '',
			imageOrigin: base.image_origin || pin.imageOrigin || '',
			accountId: base.pinterest_account_id || pin.accountId || '',
			accountLabel: base.pinterest_account_label || pin.accountLabel || '',
			boardId: base.pinterest_board_id || pin.boardId || '',
			boardName: base.pinterest_board_name || pin.boardName || '',
			suggestedKeywords: safeArray(base.suggested_keywords || pin.suggestedKeywords),
			suggestedHashtags: safeArray(base.suggested_hashtags || pin.suggestedHashtags),
			imageSource: base.image_source || pin.imageSource || 'featured',
			imageGenerationStatus: 'idle',
			imageGenerationError: '',
			cta: base.cta || '',
			style: base.style || '',
			analysis: base.analysis || null,
			brandKitId: base.brand_kit || pin.brandKitId || '',
			templateId: sourceSnapshot.templateId,
			templateName: sourceSnapshot.templateName,
			templateVersion: sourceSnapshot.templateVersion,
			templateConfig: sourceSnapshot.templateConfig,
			templateThumbnail: sourceSnapshot.templateThumbnail,
			templateSnapshotAt: sourceSnapshot.templateSnapshotAt,
		}, {
			targetAudience: base.target_audience || pin.targetAudience || '',
			toneOfVoice: base.tone_of_voice || pin.toneOfVoice || '',
			language: base.language || pin.language || '',
		});

		if (base.editor_state) {
			payload.editor_state = base.editor_state;
		}

		const created = await pb.collection('ai_pins').create(payload);
		return mapSavedPin(created);
	} catch (error) {
		throw new Error(formatPocketBaseError(error, 'Failed to duplicate pin'));
	}
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
	const readyPin = await ensureHostedImageForPin(pin);
	const selectedAccount = accounts.find((account) => account.id === readyPin.accountId);
	const selectedBoard = boards.find((board) => board.boardId === readyPin.boardId);

	const editorResponse = await apiServerClient.fetch(`/ai-pins/pins/${readyPin.id}/editor`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			title: readyPin.title,
			description: readyPin.description,
			overlayText: readyPin.overlayText,
			imagePrompt: readyPin.imagePrompt,
			imageUrl: readyPin.imageUrl,
			sourceUrl: readyPin.sourceUrl || readyPin.articleUrl || readyPin.destinationUrl || '',
			imageOrigin: readyPin.imageOrigin || '',
			cta: readyPin.cta || analysis?.cta || '',
			style: readyPin.style || panel.style,
			analysis: readyPin.analysis || analysis,
			editorState: {
				crop: readyPin.editorCrop || null,
				resize: readyPin.editorResize || { width: 1000, height: 1500 },
				overlays: readyPin.editorOverlays || [],
			},
			suggestedKeywords: safeArray(readyPin.suggestedKeywords),
			suggestedHashtags: safeArray(readyPin.suggestedHashtags),
			...toTemplateEditorPatch(readyPin),
		}),
	});
	const editorPayload = await editorResponse.json().catch(() => ({}));
	if (!editorResponse.ok) {
		throw new Error(editorPayload?.message || 'Failed to save pin editor changes');
	}

	const updated = await pb.collection('ai_pins').update(readyPin.id, {
		pinterest_account_id: readyPin.accountId || '',
		pinterest_account_label: readyPin.accountId
			? (selectedAccount?.label || selectedAccount?.accountName || selectedAccount?.username || '')
			: '',
		pinterest_board_id: readyPin.boardId || '',
		pinterest_board_name: selectedBoard?.name || readyPin.boardName || '',
		scheduled_at: readyPin.scheduledAt || '',
		scheduled_timezone: readyPin.scheduledTimezone || '',
	}).catch(() => null);

	// Keep Calendar in sync: scheduled jobs are the calendar source of truth.
	const jobId = readyPin.publishJobId || updated?.publish_job_id || '';
	if (jobId && (readyPin.status === 'scheduled' || updated?.status === 'scheduled')) {
		const jobPayload = {};
		if (readyPin.scheduledAt) jobPayload.scheduledAt = readyPin.scheduledAt;
		if (readyPin.scheduledTimezone) jobPayload.timezone = readyPin.scheduledTimezone;
		if (readyPin.accountId) jobPayload.accountId = readyPin.accountId;
		if (readyPin.boardId) jobPayload.boardId = readyPin.boardId;
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

	const editorSnapshot = mapTemplateSnapshotFromRecord(editorPayload);
	const editorHasSnapshot = Boolean(
		editorPayload.templateId
		|| editorPayload.template_id
		|| editorPayload.templateConfiguration
		|| editorPayload.template_configuration
		|| editorPayload.templateConfig,
	);

	return {
		...readyPin,
		...(updated ? mapSavedPin(updated) : {}),
		title: editorPayload.title || readyPin.title,
		description: editorPayload.description || readyPin.description,
		overlayText: editorPayload.overlayText || readyPin.overlayText,
		imagePrompt: editorPayload.imagePrompt || readyPin.imagePrompt,
		imageUrl: editorPayload.imageUrl || readyPin.imageUrl,
		sourceUrl: editorPayload.sourceUrl
			|| readyPin.sourceUrl
			|| readyPin.articleUrl
			|| readyPin.destinationUrl
			|| '',
		articleUrl: editorPayload.sourceUrl
			|| readyPin.articleUrl
			|| readyPin.sourceUrl
			|| '',
		destinationUrl: editorPayload.sourceUrl
			|| readyPin.destinationUrl
			|| readyPin.sourceUrl
			|| '',
		imageOrigin: editorPayload.imageOrigin || readyPin.imageOrigin || '',
		cta: editorPayload.cta || '',
		style: editorPayload.style || panel.style,
		analysis: editorPayload.analysis || analysis,
		...(editorHasSnapshot ? editorSnapshot : {}),
	};
}

export async function deleteDraftPin(pinId) {
	await pb.collection('ai_pins').delete(pinId);
}
