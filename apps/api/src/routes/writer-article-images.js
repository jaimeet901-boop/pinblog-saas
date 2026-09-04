/**
 * POST /writer-article-images — M3-A post-generation image side-channel.
 *
 * Does NOT touch the Writer text stream, LLM prompts, or HTML composition.
 * workspaceKey is taken only from authenticated req.workspaceKey.
 */

import { Router } from 'express';
import { integratedAiRateLimit } from '../middleware/integrated-ai-rate-limit.js';
import { pocketbaseAuth } from '../middleware/pocketbase-auth.js';
import { attachWorkspace, requireWorkspaceMutation, requireWorkspaceRead } from '../middleware/product-access.js';
import { assertFeatureAccess } from '../services/plan-access-guard.js';
import { getPlatformProviderApiKey } from '../services/ai-providers.js';
import {
	normalizeWriterImageCount,
	runWriterArticleImages,
} from '../services/writer-article-images.js';
import logger from '../utils/logger.js';

const router = Router();

router.use(pocketbaseAuth);
router.use(attachWorkspace);
router.use(requireWorkspaceRead);

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function trimStr(value) {
	return String(value || '').trim();
}

/**
 * Strip any client-supplied workspaceKey / secrets from body before processing.
 */
function sanitizeClientBody(body = {}) {
	const article = body?.article && typeof body.article === 'object' && !Array.isArray(body.article)
		? body.article
		: null;
	return {
		article,
		imageCount: body?.imageCount,
		requestId: trimStr(body?.requestId).slice(0, 120),
	};
}

router.post('/', integratedAiRateLimit, requireWorkspaceMutation('workspace.ai.generate'), async (req, res) => {
	try {
		await assertFeatureAccess(req, 'aiWriter', {
			message: 'AI Writer requires a plan upgrade. Open Subscription to unlock article images.',
		});

		const workspaceKey = trimStr(req.workspaceKey);
		if (!workspaceKey) {
			throw httpError(422, 'workspaceKey is required', 'WORKSPACE_KEY_REQUIRED');
		}

		const { article, imageCount: rawCount, requestId } = sanitizeClientBody(req.body);
		const imageCount = normalizeWriterImageCount(rawCount);

		// Defense-in-depth: never plan/resolve when imageCount is 0
		if (imageCount === 0) {
			return res.status(200).json({
				ok: true,
				skipped: true,
				reason: 'imageCount=0',
			});
		}

		if (!article) {
			throw httpError(422, 'article is required', 'VALIDATION_ERROR');
		}

		// Ignore any client attempt to override wallet identity
		if (req.body?.workspaceKey != null || req.body?.workspace_key != null) {
			logger.info('[writer-article-images] ignoring client-supplied workspaceKey');
		}

		const result = await runWriterArticleImages(
			{
				article,
				imageCount,
				requestId: requestId || `writer-images:${Date.now()}`,
				workspaceKey,
				allowFal: true,
				maxFalImages: Math.min(imageCount, 3),
			},
			{
				getFalApiKey: async () => getPlatformProviderApiKey('fal'),
				getPexelsApiKey: async () => trimStr(process.env.PEXELS_API_KEY),
			},
		);

		if (result.images == null) {
			return res.status(200).json({
				ok: true,
				skipped: true,
				reason: result.reason || 'skipped',
			});
		}

		return res.status(200).json({
			ok: true,
			skipped: false,
			images: result.images,
		});
	} catch (error) {
		const status = Number(error?.status) || 500;
		const safeMessage = status >= 500
			? 'Article images are temporarily unavailable'
			: (trimStr(error?.message).slice(0, 200) || 'Article images request failed');

		logger.warn('[writer-article-images] request failed', {
			status,
			errorCode: error?.errorCode || null,
			message: safeMessage,
			// never log Authorization / API keys
		});

		return res.status(status >= 400 && status < 600 ? status : 500).json({
			ok: false,
			errorCode: error?.errorCode || 'WRITER_ARTICLE_IMAGES_FAILED',
			message: safeMessage,
		});
	}
});

export default router;
