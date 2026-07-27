import { Router } from 'express';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import {
	getArticleLifecycleStatus,
	updateArticleLifecycleStatus,
	retryFailedArticleStage,
	getArticleLifecycleTimeline,
	getArticleLifecycleProgress,
} from '../services/article-lifecycle.js';

const router = Router({ mergeParams: true });

function asyncHandler(fn) {
	return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

async function assertArticleBelongsToWebsite(articleId, websiteId, ownerId) {
	if (!websiteId) return;
	const article = await pocketbaseClient.collection('website_articles').getOne(articleId).catch(() => null);
	if (!article) throw httpError(404, 'Article not found', 'NOT_FOUND');
	const owner = typeof article.owner === 'string' ? article.owner : article.owner?.id;
	if (owner !== ownerId) throw httpError(403, 'Forbidden', 'FORBIDDEN');
	const articleWebsite = article.websiteId || article.website_id || article.website || '';
	if (articleWebsite && articleWebsite !== websiteId) {
		throw httpError(404, 'Article not found for this website', 'NOT_FOUND');
	}
}

router.get('/status', asyncHandler(async (req, res) => {
	await assertArticleBelongsToWebsite(req.params.articleId, req.params.websiteId, req.pocketbaseUserId);
	const lifecycle = await getArticleLifecycleStatus(req.pocketbaseUserId, req.params.articleId);
	res.json(lifecycle);
}));

router.patch('/status', asyncHandler(async (req, res) => {
	await assertArticleBelongsToWebsite(req.params.articleId, req.params.websiteId, req.pocketbaseUserId);
	const result = await updateArticleLifecycleStatus(
		req.pocketbaseUserId,
		req.params.articleId,
		req.body || {},
	);
	res.json(result);
}));

router.put('/status', asyncHandler(async (req, res) => {
	await assertArticleBelongsToWebsite(req.params.articleId, req.params.websiteId, req.pocketbaseUserId);
	const result = await updateArticleLifecycleStatus(
		req.pocketbaseUserId,
		req.params.articleId,
		req.body || {},
	);
	res.json(result);
}));

router.post('/retry', asyncHandler(async (req, res) => {
	await assertArticleBelongsToWebsite(req.params.articleId, req.params.websiteId, req.pocketbaseUserId);
	const result = await retryFailedArticleStage(
		req.pocketbaseUserId,
		req.params.articleId,
		req.body || {},
	);
	res.json(result);
}));

router.get('/timeline', asyncHandler(async (req, res) => {
	await assertArticleBelongsToWebsite(req.params.articleId, req.params.websiteId, req.pocketbaseUserId);
	const timeline = await getArticleLifecycleTimeline(
		req.pocketbaseUserId,
		req.params.articleId,
		{
			page: Number(req.query.page) || 1,
			perPage: Number(req.query.perPage) || 50,
		},
	);
	res.json(timeline);
}));

router.get('/progress', asyncHandler(async (req, res) => {
	await assertArticleBelongsToWebsite(req.params.articleId, req.params.websiteId, req.pocketbaseUserId);
	const progress = await getArticleLifecycleProgress(
		req.pocketbaseUserId,
		req.params.articleId,
	);
	res.json(progress);
}));

export default router;
