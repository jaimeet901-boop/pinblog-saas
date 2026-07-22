import pocketbaseClient from '../utils/pocketbaseClient.js';
import { assertCapability } from './workspace-rbac.js';

/**
 * Unified generation / publishing history for the workspace owner.
 * Isolates by owner (personal workspace) — never cross-tenant.
 */
export async function getWorkspaceHistory(req, query = {}) {
	assertCapability(req, 'workspace.read');
	const ownerId = req.pocketbaseUserId;
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(50, Math.max(1, Number(query.perPage) || 20));
	const type = String(query.type || 'all').toLowerCase();

	const [articles, pins, generations, publishJobs, imageJobs] = await Promise.all([
		type === 'all' || type === 'articles'
			? pocketbaseClient.collection('articles').getList(page, perPage, {
				filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
				sort: '-created',
				requestKey: null,
			}).catch(() => ({ items: [], totalItems: 0 }))
			: Promise.resolve({ items: [], totalItems: 0 }),
		type === 'all' || type === 'images' || type === 'recipes'
			? pocketbaseClient.collection('pins').getList(page, perPage, {
				filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
				sort: '-created',
				requestKey: null,
			}).catch(() => ({ items: [], totalItems: 0 }))
			: Promise.resolve({ items: [], totalItems: 0 }),
		type === 'all' || type === 'exports' || type === 'generations'
			? pocketbaseClient.collection('ai_pin_generation_history').getList(page, perPage, {
				filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
				sort: '-created',
				requestKey: null,
			}).catch(() => ({ items: [], totalItems: 0 }))
			: Promise.resolve({ items: [], totalItems: 0 }),
		type === 'all' || type === 'publishing'
			? pocketbaseClient.collection('pinterest_publish_jobs').getList(page, perPage, {
				filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
				sort: '-created',
				requestKey: null,
			}).catch(() => ({ items: [], totalItems: 0 }))
			: Promise.resolve({ items: [], totalItems: 0 }),
		type === 'all' || type === 'images'
			? pocketbaseClient.collection('ai_pin_image_jobs').getList(page, perPage, {
				filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
				sort: '-created',
				requestKey: null,
			}).catch(() => ({ items: [], totalItems: 0 }))
			: Promise.resolve({ items: [], totalItems: 0 }),
	]);

	const items = [];

	for (const article of articles.items) {
		items.push({
			id: `article-${article.id}`,
			type: 'article',
			title: article.seo_title || article.keyword || 'Article',
			status: article.status,
			createdAt: article.created,
			meta: { keyword: article.keyword },
		});
	}
	for (const pin of pins.items) {
		items.push({
			id: `image-${pin.id}`,
			type: pin.image_url ? 'image' : 'recipe',
			title: pin.title || 'Pin',
			status: pin.status,
			createdAt: pin.created,
			meta: { imageUrl: pin.image_url },
		});
	}
	for (const row of generations.items) {
		items.push({
			id: `gen-${row.id}`,
			type: 'generation',
			title: row.title || row.overlay_text || 'Generation',
			status: row.status || 'completed',
			createdAt: row.created,
			meta: {},
		});
	}
	for (const job of publishJobs.items) {
		items.push({
			id: `publish-${job.id}`,
			type: 'publishing',
			title: job.title || 'Publish job',
			status: job.status,
			createdAt: job.created,
			meta: { scheduledAt: job.scheduled_at, publishedAt: job.published_at },
		});
	}
	for (const job of imageJobs.items) {
		items.push({
			id: `imgjob-${job.id}`,
			type: 'image',
			title: job.prompt?.slice?.(0, 80) || 'Image job',
			status: job.status,
			createdAt: job.created,
			meta: { imageUrl: job.image_url },
		});
	}

	items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

	return {
		items: items.slice(0, perPage),
		page,
		perPage,
		totalItems: items.length,
		counts: {
			articles: articles.totalItems || 0,
			images: (pins.totalItems || 0) + (imageJobs.totalItems || 0),
			publishing: publishJobs.totalItems || 0,
			generations: generations.totalItems || 0,
		},
	};
}
