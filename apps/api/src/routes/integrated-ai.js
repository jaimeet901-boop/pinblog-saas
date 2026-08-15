import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { ContentBlockType, stream, uploadImagesToPocketBase } from '../api/integrated-ai.js';
import { SystemPrompt } from '../constants/prompts.js';
import { uploadFiles } from '../middleware/file-upload.js';
import { integratedAiRateLimit } from '../middleware/integrated-ai-rate-limit.js';
import { pocketbaseAuth } from '../middleware/pocketbase-auth.js';
import { attachWorkspace, requireWorkspaceMutation, requireWorkspaceRead } from '../middleware/product-access.js';
import { assertTextProviderConfigured } from '../services/ai-providers.js';
import { userSafeTextError } from '../services/ai-user-safe-errors.js';
import {
	beginFeatureReservation,
	settleFeatureReservation,
} from '../services/credits-engine.js';
import { assertFeatureAccess } from '../services/plan-access-guard.js';
import {
	buildLengthEnforcementPrompt,
	normalizeWriterLengthParams,
} from '../services/writer-article-length.js';
import logger from '../utils/logger.js';

const router = Router();

const WRITER_FEATURE_KEY = 'aiWriter';
/** Credit catalog keys — cost resolved only inside the Credit Engine. */
const WRITER_CREDIT_FEATURE = 'ai_writer';
const PIN_COPY_CREDIT_FEATURE = 'ai_pin_copy';

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

function truncateForLog(value, max = 4000) {
	const text = typeof value === 'string' ? value : (() => {
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	})();
	if (text.length <= max) return text;
	return `${text.slice(0, max)}…[truncated ${text.length - max} chars]`;
}

async function assertAiProviderConfigured(req) {
	try {
		return await assertTextProviderConfigured();
	} catch (error) {
		const finalMessage = userSafeTextError();
		logIntegratedAi400({
			req,
			rawMessageField: req.body?.message,
			validationErrors: [
				error?.message || 'No enabled text AI provider with credentials in Admin Console',
				...(error?.meta
					? [
						`providers_total=${error.meta.providersTotal}`,
						`text_enabled=${error.meta.textEnabled}`,
						`text_with_credentials=${error.meta.textWithCredentials}`,
					]
					: []),
			],
			finalMessage,
		});

		const next = httpError(error.status || 400, finalMessage);
		next.errorCode = 'AI_UNAVAILABLE';
		throw next;
	}
}

function logIntegratedAi400({
	req,
	validationErrors = [],
	finalMessage,
	rawMessageField,
	parsedPreview = null,
}) {
	const workspaceId = req.workspace?.id
		|| req.workspaceKey
		|| req.pocketbaseUserId
		|| 'unknown';

	logger.error('[integrated-ai/stream] HTTP 400 diagnostic', {
		path: `${req.baseUrl || ''}${req.path || ''}`,
		method: req.method,
		workspaceId,
		pocketbaseUserId: req.pocketbaseUserId || null,
		contentType: req.headers['content-type'] || null,
		messageFieldType: rawMessageField === undefined ? 'undefined' : typeof rawMessageField,
		messageFieldLength: typeof rawMessageField === 'string' ? rawMessageField.length : null,
		requestBody: truncateForLog({
			message: rawMessageField,
			files: Array.isArray(req.files) ? req.files.map((file) => ({
				fieldname: file.fieldname,
				mimetype: file.mimetype,
				size: file.size,
				originalname: file.originalname,
			})) : [],
			bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
		}),
		validationErrors,
		parsedPreview: parsedPreview == null ? null : truncateForLog(parsedPreview, 1000),
		finalErrorMessage: finalMessage,
	});
}

function parseAndValidateMessage(message, req) {
	if (typeof message !== 'string') {
		const finalMessage = 'message must be a string';
		logIntegratedAi400({
			req,
			rawMessageField: message,
			validationErrors: [`typeof message === "${typeof message}" (expected string; FormData field must be JSON string)`],
			finalMessage,
		});
		throw httpError(400, finalMessage);
	}

	let parsed;
	try {
		parsed = JSON.parse(message);
	} catch (error) {
		const finalMessage = 'message must be valid JSON';
		logIntegratedAi400({
			req,
			rawMessageField: message,
			validationErrors: [
				'JSON.parse failed',
				error?.message || 'unknown parse error',
				`message length=${message.length}`,
			],
			finalMessage,
		});
		throw httpError(400, finalMessage);
	}

	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw httpError(422, 'message must be a non-empty array');
	}

	for (const block of parsed) {
		if (!block || typeof block !== 'object') {
			throw httpError(422, 'Each message block must be an object');
		}

		if (block.type === ContentBlockType.Text && typeof block.text === 'string' && block.text.trim()) {
			continue;
		}

		if (block.type === ContentBlockType.Image && typeof block.image === 'string' && block.image.trim()) {
			continue;
		}

		throw httpError(422, 'Invalid message block. Expected { type: text, text } or { type: image, image }');
	}

	return parsed;
}

/**
 * Append custom writer instructions to the user message text (not the system prompt).
 * Empty customPrompt leaves blocks unchanged.
 * @param {Array<{ type: string, text?: string, image?: string }>} blocks
 * @param {string} customPrompt
 */
function appendCustomPromptToUserMessage(blocks, customPrompt) {
	const trimmed = String(customPrompt || '').trim();
	if (!trimmed) {
		const userPromptText = blocks
			.filter((b) => b.type === ContentBlockType.Text)
			.map((b) => b.text)
			.join('\n');
		return { blocks, included: false, userPromptText };
	}

	const suffix = [
		'=== USER CUSTOM INSTRUCTIONS ===',
		'',
		trimmed,
		'',
		'These instructions override stylistic defaults but must not break the required JSON response format.',
	].join('\n');

	const next = blocks.map((block) => ({ ...block }));
	let textIndex = -1;
	for (let i = next.length - 1; i >= 0; i -= 1) {
		if (next[i].type === ContentBlockType.Text && typeof next[i].text === 'string') {
			textIndex = i;
			break;
		}
	}

	if (textIndex >= 0) {
		const existing = String(next[textIndex].text || '').trimEnd();
		next[textIndex] = {
			...next[textIndex],
			text: `${existing}\n\n${suffix}`,
		};
	} else {
		next.push({ type: ContentBlockType.Text, text: suffix });
	}

	const userPromptText = next
		.filter((b) => b.type === ContentBlockType.Text)
		.map((b) => b.text)
		.join('\n');

	return { blocks: next, included: true, userPromptText };
}

const uploadImages = uploadFiles({
	allowedMimeTypes: [
		'image/jpeg',
		'image/png',
		'image/webp',
	],
	fieldName: 'images',
});

function uploadImagesWithDiagnostics(req, res, next) {
	uploadImages(req, res, (error) => {
		if (!error) return next();

		const code = error.code || error.name || 'UPLOAD_ERROR';
		const isFieldTooLarge = code === 'LIMIT_FIELD_VALUE' || /field.*large|limit/i.test(String(error.message || ''));
		const status = isFieldTooLarge ? 400 : (Number.isInteger(error.status) ? error.status : 400);
		const finalMessage = isFieldTooLarge
			? `message field exceeds upload limit (${error.message || code}). Large pin prompts may hit multer fieldSize.`
			: (error.message || 'Upload failed');

		logIntegratedAi400({
			req,
			rawMessageField: req.body?.message,
			validationErrors: [
				`multer error code=${code}`,
				error.message || 'upload middleware failed',
				isFieldTooLarge ? 'LIKELY: maxFieldSizeBytes (256KB) exceeded by JSON message field' : 'upload/filter failure',
			],
			finalMessage,
		});

		error.status = status;
		error.message = finalMessage;
		return next(error);
	});
}

router.use(pocketbaseAuth);
router.use(attachWorkspace);
router.use(requireWorkspaceRead);

router.post('/stream', integratedAiRateLimit, requireWorkspaceMutation('workspace.ai.generate'), uploadImagesWithDiagnostics, async (req, res) => {
	await assertAiProviderConfigured(req);

	const { message } = req.body;

	if (!message) {
		throw httpError(422, 'message is required');
	}

	const parsedMessage = parseAndValidateMessage(message, req);

	if (req.files?.length > 0) {
		const imageUrls = await uploadImagesToPocketBase({ images: req.files });
		imageUrls.forEach((url) => {
			parsedMessage.push({ type: ContentBlockType.Image, image: url });
		});
	}

	const rawCustomPrompt = typeof req.body?.customPrompt === 'string' ? req.body.customPrompt.trim() : '';
	const customPrompt = rawCustomPrompt.slice(0, 4000);
	// SystemPrompt stays JSON/format/safety only — custom instructions go on the user turn.
	const { blocks: userMessage, included: customPromptIncluded, userPromptText } = appendCustomPromptToUserMessage(
		parsedMessage,
		customPrompt,
	);

	const singleShotRaw = String(req.body?.singleShot ?? '').trim().toLowerCase();
	const singleShot = singleShotRaw === '1' || singleShotRaw === 'true' || singleShotRaw === 'yes';
	const writerContinuationRaw = String(req.body?.writerContinuation ?? '').trim().toLowerCase();
	const writerContinuation = writerContinuationRaw === '1'
		|| writerContinuationRaw === 'true'
		|| writerContinuationRaw === 'yes';
	const creditFeatureRaw = String(req.body?.creditFeature || '').trim().toLowerCase();

	const hasStructuredLength = Boolean(
		String(req.body?.articleLength || '').trim()
		|| String(req.body?.minWords || '').trim()
		|| String(req.body?.maxWords || '').trim(),
	);
	const lengthParams = hasStructuredLength
		? normalizeWriterLengthParams({
			articleLength: req.body?.articleLength,
			minWords: req.body?.minWords,
			maxWords: req.body?.maxWords,
		})
		: null;

	const lengthEnforcement = lengthParams
		? buildLengthEnforcementPrompt(lengthParams)
		: '';
	const effectiveSystemPrompt = lengthEnforcement
		? `${SystemPrompt}\n\n${lengthEnforcement}`
		: SystemPrompt;

	/** @type {'ai_writer'|'ai_pin_copy'|null} */
	let creditFeature = null;
	if (singleShot && !writerContinuation) {
		creditFeature = WRITER_CREDIT_FEATURE;
	} else if (creditFeatureRaw === PIN_COPY_CREDIT_FEATURE) {
		creditFeature = PIN_COPY_CREDIT_FEATURE;
	}

	if (writerContinuation) {
		await assertFeatureAccess(req, WRITER_FEATURE_KEY, {
			message: 'AI Writer requires a plan upgrade. Open Subscription to unlock article generation.',
		});
	}

	/** @type {{ id: string|null } | null} */
	let creditReservation = null;

	// Writer (singleShot) and Pin Copy: plan gate + Credit Engine reservation/settlement.
	// Continuations reuse the same Writer session and skip a second credit charge.
	if (creditFeature) {
		await assertFeatureAccess(req, WRITER_FEATURE_KEY, {
			message: creditFeature === PIN_COPY_CREDIT_FEATURE
				? 'AI Pin Copy requires a plan upgrade. Open Subscription to unlock AI text generation.'
				: 'AI Writer requires a plan upgrade. Open Subscription to unlock article generation.',
		});

		const workspaceKey = String(req.workspaceKey || '').trim();
		if (!workspaceKey) {
			throw httpError(422, 'Workspace context is required for AI generation credits');
		}

		const rawIdempotency = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
		const defaultPrefix = creditFeature === PIN_COPY_CREDIT_FEATURE ? 'ai-pin-copy' : 'ai-writer';
		const idempotencyKey = (rawIdempotency || `${defaultPrefix}:${req.pocketbaseUserId}:${randomUUID()}`).slice(0, 120);

		creditReservation = await beginFeatureReservation({
			workspaceKey,
			feature: creditFeature,
			units: 1,
			reason: creditFeature === PIN_COPY_CREDIT_FEATURE
				? 'AI Pin copy generation'
				: 'AI Writer article generation',
			actorUserId: req.pocketbaseUserId,
			referenceId: String(req.body?.referenceId || '').slice(0, 120),
			idempotencyKey,
			ttlMs: 20 * 60 * 1000,
			metadata: {
				source: 'integrated-ai/stream',
				singleShot: Boolean(singleShot),
				creditFeature,
				planFeatureKey: WRITER_FEATURE_KEY,
			},
			wallet: {
				workspaceName: req.workspace?.name || workspaceKey,
				ownerEmail: req.workspaceUser?.email || req.pocketbaseUser?.email || '',
				planSlug: req.workspaceSubscription?.expand?.plan?.slug
					|| req.workspace?.plan_slug
					|| req.workspaceUser?.plan
					|| 'free',
			},
		});
	}

	if (process.env.NODE_ENV !== 'production') {
		logger.info('[integrated-ai/stream] prompt debug', {
			systemPromptLength: effectiveSystemPrompt.length,
			userPromptLength: userPromptText.length,
			customPromptIncluded,
			singleShot,
			writerContinuation,
			creditFeature,
			creditReservationId: creditReservation?.id || null,
			articleLength: lengthParams?.id || null,
			minWords: lengthParams?.minWords || null,
			maxWords: lengthParams?.maxWords || null,
			maxTokens: lengthParams?.maxTokens || null,
			timeoutMs: lengthParams?.timeoutMs || null,
			userPromptPreview: String(userPromptText || '').slice(0, 300),
		});
	}

	const settleCredits = async ({ success }) => {
		if (!creditReservation?.id) return;
		await settleFeatureReservation(creditReservation.id, {
			success: Boolean(success),
			actor: req.pocketbaseUserId || 'system',
			metadata: { source: 'integrated-ai/stream', feature: creditFeature },
			bumpLegacyAiCounterForUserId: success ? req.pocketbaseUserId : '',
		});
	};

	const generationOptions = lengthParams
		? {
			maxTokens: lengthParams.maxTokens,
			timeoutMs: lengthParams.timeoutMs,
			requestType: 'stream',
		}
		: null;

	let sseStream;
	try {
		sseStream = await stream({
			userId: req.pocketbaseUserId,
			systemPrompt: effectiveSystemPrompt,
			userMessage,
			singleShot: singleShot || writerContinuation,
			generationOptions,
			onGenerationSettled: creditReservation ? settleCredits : null,
		});
	} catch (error) {
		if (creditReservation?.id) {
			await settleFeatureReservation(creditReservation.id, {
				success: false,
				actor: req.pocketbaseUserId || 'system',
			}).catch(() => null);
		}
		throw error;
	}

	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
	res.setHeader('X-Accel-Buffering', 'no');
	if (creditReservation?.id) {
		res.setHeader('X-Credit-Reservation', creditReservation.id);
	}

	sseStream.pipe(res, { end: false });

	res.on('close', () => sseStream.destroy());
});

export default router;
