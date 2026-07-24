import { Router } from 'express';
import { ContentBlockType, stream, uploadImagesToPocketBase } from '../api/integrated-ai.js';
import { SystemPrompt } from '../constants/prompts.js';
import { uploadFiles } from '../middleware/file-upload.js';
import { integratedAiRateLimit } from '../middleware/integrated-ai-rate-limit.js';
import { pocketbaseAuth } from '../middleware/pocketbase-auth.js';
import { listProviders } from '../services/ai-providers.js';
import logger from '../utils/logger.js';

const router = Router();

const NO_AI_PROVIDER_MESSAGE = 'No AI provider configured. Please configure an AI provider in Admin Settings.';

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

function resolveProviderLabel() {
	const url = String(process.env.INTEGRATED_AI_API_URL || '').trim();
	if (!url) return 'integrated-ai (INTEGRATED_AI_API_URL unset)';
	try {
		return `integrated-ai@${new URL(url).host}`;
	} catch {
		return 'integrated-ai (invalid INTEGRATED_AI_API_URL)';
	}
}

async function assertAiProviderConfigured(req) {
	const providers = await listProviders().catch(() => []);
	const configured = providers.filter((provider) => (
		provider.enabled
		&& (provider.config?.hasApiKey || provider.config?.hasSecretKey)
	));

	if (configured.length > 0) {
		return configured;
	}

	const finalMessage = NO_AI_PROVIDER_MESSAGE;
	logIntegratedAi400({
		req,
		rawMessageField: req.body?.message,
		validationErrors: [
			'No enabled AI provider with credentials in Admin Console',
			`providers_total=${providers.length}`,
			`providers_enabled=${providers.filter((item) => item.enabled).length}`,
			`providers_with_credentials=${providers.filter((item) => item.config?.hasApiKey || item.config?.hasSecretKey).length}`,
		],
		finalMessage,
	});

	const error = httpError(400, finalMessage);
	error.errorCode = 'AI_PROVIDER_NOT_CONFIGURED';
	throw error;
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
		provider: resolveProviderLabel(),
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

router.post('/stream', integratedAiRateLimit, uploadImagesWithDiagnostics, async (req, res) => {
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

	const sseStream = await stream({
		userId: req.pocketbaseUserId,
		systemPrompt: SystemPrompt,
		userMessage: parsedMessage,
	});

	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
	res.setHeader('X-Accel-Buffering', 'no');

	sseStream.pipe(res, { end: false });

	res.on('close', () => sseStream.destroy());
});

export default router;
