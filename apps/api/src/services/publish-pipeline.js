import { randomBytes } from 'node:crypto';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import {
	getOwnedPinterestAccount,
	getDefaultPinterestBoard,
} from './pinterest-api.js';
import {
	getPinterestAppCredentials,
	isPinterestOAuthReady,
} from './pinterest-app-credentials.js';
import { mirrorPinterestJob } from './queue/mirrors.js';
import { notifyWorkspaceUser, logWorkflowStep } from './workspace-notify.js';
import { enqueueAnalyticsRefresh } from './analytics/refresh.js';
import { sanitizeCollectionPayload } from '../utils/pocketbase-safe-query.js';

function workflowIdFor(job) {
	return String(job.workflow_id || job.payload?.workflowId || `wf-${job.id}`).slice(0, 80);
}

function shouldEnqueuePinterest(job) {
	const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
	if (payload.enqueuePinterest === false || job.enqueue_pinterest === false) return false;
	if (payload.enqueuePinterest === true || job.enqueue_pinterest === true) return true;
	// Default: auto-queue when a Pinterest account exists for the owner
	return true;
}

async function ensureWebsiteCatalogArticle({
	ownerId,
	websiteId,
	title,
	url,
	slug,
	featuredImage,
	publishDate,
}) {
	if (!websiteId || !url) return null;

	const existing = await pocketbaseClient.collection('website_articles').getFirstListItem(
		pocketbaseClient.filter('websiteId = {:website} && url = {:url}', {
			website: websiteId,
			url,
		}),
		{ requestKey: null },
	).catch(() => null);

	const payload = {
		websiteId,
		owner: ownerId,
		url,
		slug: String(slug || '').slice(0, 255),
		title: String(title || '').slice(0, 500),
		featured_image: String(featuredImage || '').slice(0, 1000),
		publish_date: publishDate || new Date().toISOString(),
		status: 'published',
		source: 'chef_ia_workflow',
	};

	if (existing) {
		return pocketbaseClient.collection('website_articles').update(existing.id, payload).catch(() => existing);
	}
	return pocketbaseClient.collection('website_articles').create(payload).catch(() => null);
}

async function createWorkflowPin({
	ownerId,
	websiteId,
	articleId,
	title,
	description,
	imageUrl,
	boardId,
	boardName,
}) {
	const pinPayload = await sanitizeCollectionPayload({
		collection: 'ai_pins',
		context: 'publish-pipeline:create-pin',
		payload: {
			owner: ownerId,
			websiteId,
			articleId,
			title: String(title || 'Untitled pin').slice(0, 300),
			description: String(description || '').slice(0, 2000),
			image_url: String(imageUrl || '').slice(0, 1000),
			status: 'scheduled',
			image_source: 'featured',
			pinterest_board_id: boardId || '',
			pinterest_board_name: boardName || '',
			publish_error: '',
		},
	});

	return pocketbaseClient.collection('ai_pins').create(pinPayload);
}

/**
 * After WordPress publish succeeds: notify, analytics, optional Pinterest handoff.
 */
export async function continueChefIaPublishWorkflow({
	job,
	result,
	historyResult,
	mediaId = 0,
	site = null,
}) {
	const ownerId = job.owner;
	const workflowId = workflowIdFor(job);
	const publishedUrl = result?.link || job.wp_post_url || '';
	const isRetrySuccess = Number(job.attempt_count || 0) > 0;

	await logWorkflowStep({
		ownerId,
		action: 'workflow.wordpress_publish',
		resourceType: 'publish_jobs',
		resourceId: job.id,
		metadata: {
			workflowId,
			wpPostId: result?.id || job.wp_post_id,
			publishedUrl,
			historyResult,
			mediaId,
		},
	});

	await notifyWorkspaceUser({
		ownerId,
		title: isRetrySuccess
			? 'Retry completed — WordPress publish succeeded'
			: (historyResult === 'scheduled'
				? 'WordPress post scheduled'
				: 'WordPress publish succeeded'),
		body: publishedUrl
			? `${job.title || 'Post'} is live at ${publishedUrl}`
			: `${job.title || 'Post'} finished with status ${historyResult || 'published'}`,
		priority: 'normal',
		meta: {
			type: isRetrySuccess ? 'publish_retry_success' : 'publish_success',
			workflowId,
			jobId: job.id,
			provider: 'wordpress',
			url: publishedUrl,
		},
	});

	await enqueueAnalyticsRefresh(ownerId).catch(() => null);

	if (!shouldEnqueuePinterest(job)) {
		await logWorkflowStep({
			ownerId,
			action: 'workflow.pinterest_skipped',
			resourceType: 'publish_jobs',
			resourceId: job.id,
			metadata: { workflowId, reason: 'disabled' },
		});
		return { pinterestJobId: null, status: 'skipped' };
	}

	const account = await getOwnedPinterestAccount(ownerId).catch(() => null);
	if (!account) {
		await logWorkflowStep({
			ownerId,
			action: 'workflow.pinterest_skipped',
			resourceType: 'publish_jobs',
			resourceId: job.id,
			metadata: { workflowId, reason: 'no_pinterest_account' },
		});
		return { pinterestJobId: null, status: 'skipped' };
	}

	const imageUrl = String(
		job.featured_image_url
		|| result?.featured_media_url
		|| '',
	).trim();

	if (!imageUrl) {
		await logWorkflowStep({
			ownerId,
			action: 'workflow.pinterest_skipped',
			resourceType: 'publish_jobs',
			resourceId: job.id,
			result: 'error',
			metadata: { workflowId, reason: 'missing_featured_image' },
		});
		return { pinterestJobId: null, status: 'skipped_no_image' };
	}

	const websiteId = site?.website || job.payload?.websiteId || '';
	if (!websiteId) {
		await logWorkflowStep({
			ownerId,
			action: 'workflow.pinterest_skipped',
			resourceType: 'publish_jobs',
			resourceId: job.id,
			result: 'error',
			metadata: { workflowId, reason: 'missing_website_id' },
		});
		return { pinterestJobId: null, status: 'skipped_no_website' };
	}

	const catalogArticle = await ensureWebsiteCatalogArticle({
		ownerId,
		websiteId,
		title: job.title,
		url: publishedUrl || `https://pending.local/${job.id}`,
		slug: job.slug || result?.slug || '',
		featuredImage: imageUrl,
		publishDate: new Date().toISOString(),
	});

	if (!catalogArticle?.id) {
		await logWorkflowStep({
			ownerId,
			action: 'workflow.pinterest_queue',
			result: 'error',
			resourceType: 'publish_jobs',
			resourceId: job.id,
			metadata: { workflowId, reason: 'website_article_create_failed' },
		});
		return { pinterestJobId: null, status: 'failed_article' };
	}

	const oauthReady = await isPinterestOAuthReady().catch(() => false);
	const accountReady = Boolean(account.connected)
		&& (!account.status || account.status === 'connected');
	const board = accountReady
		? await getDefaultPinterestBoard({ owner: ownerId, accountId: account.id }).catch(() => null)
		: null;

	const waitingProvider = !oauthReady || !accountReady || !board;
	const boardId = board?.board_id || 'pending';
	const boardName = board?.name || 'Pending board';
	const scheduledAt = new Date().toISOString();

	let pin;
	try {
		pin = await createWorkflowPin({
			ownerId,
			websiteId,
			articleId: catalogArticle.id,
			title: job.title,
			description: job.excerpt || job.meta_description || '',
			imageUrl,
			boardId: waitingProvider ? '' : boardId,
			boardName: waitingProvider ? '' : boardName,
		});
	} catch (error) {
		logger.warn(`[publish-pipeline] pin create failed: ${error.message}`);
		await logWorkflowStep({
			ownerId,
			action: 'workflow.pinterest_queue',
			result: 'error',
			resourceType: 'publish_jobs',
			resourceId: job.id,
			metadata: { workflowId, error: error.message },
		});
		return { pinterestJobId: null, status: 'failed_pin' };
	}

	const jobStatus = waitingProvider ? 'waiting_provider' : 'scheduled';
	const createPayload = await sanitizeCollectionPayload({
		collection: 'pinterest_publish_jobs',
		context: 'publish-pipeline:create-pinterest-job',
		payload: {
			owner: ownerId,
			account: account.id,
			account_label: account.label || account.account_name || account.username || '',
			account_username: account.username || '',
			ai_pin: pin.id,
			websiteId,
			articleId: catalogArticle.id,
			board_id: boardId,
			board_name: boardName,
			scheduled_at: scheduledAt,
			timezone: job.timezone || 'UTC',
			status: jobStatus,
			attempt_count: 0,
			max_attempts: 3,
			next_retry_at: '',
			last_error: waitingProvider
				? 'Waiting for Pinterest provider credentials / Trial Access approval'
				: '',
			workflow_id: workflowId,
			source_publish_job: job.id,
			destination_url: publishedUrl,
		},
	});

	const pinterestJob = await pocketbaseClient.collection('pinterest_publish_jobs').create(createPayload);

	await pocketbaseClient.collection('ai_pins').update(pin.id, {
		status: waitingProvider ? 'draft' : 'scheduled',
		scheduled_at: waitingProvider ? '' : scheduledAt,
		scheduled_timezone: job.timezone || 'UTC',
		pinterest_account_id: account.id,
		pinterest_account_label: account.label || account.username || '',
		pinterest_board_id: waitingProvider ? '' : boardId,
		pinterest_board_name: waitingProvider ? '' : boardName,
		publish_job_id: pinterestJob.id,
		publish_error: waitingProvider
			? 'Waiting for Pinterest provider credentials'
			: '',
	}).catch(() => null);

	await pocketbaseClient.collection('pinterest_publish_events').create({
		owner: ownerId,
		job: pinterestJob.id,
		event_type: waitingProvider ? 'waiting_provider' : 'scheduled',
		message: waitingProvider
			? 'Pinterest job queued — waiting for provider credentials'
			: 'Pinterest job queued from WordPress workflow',
		payload: {
			workflowId,
			sourcePublishJob: job.id,
			destinationUrl: publishedUrl,
			oauthReady,
			accountReady: Boolean(accountReady),
			hasBoard: Boolean(board),
		},
	}).catch(() => null);

	await mirrorPinterestJob(pinterestJob, pin, waitingProvider
		? 'Pinterest job waiting for provider'
		: 'Pinterest job queued from WordPress workflow').catch(() => null);

	await pocketbaseClient.collection('publish_jobs').update(job.id, {
		workflow_id: workflowId,
		enqueue_pinterest: true,
		pinterest_job_id: pinterestJob.id,
		payload: {
			...(job.payload && typeof job.payload === 'object' ? job.payload : {}),
			workflowId,
			pinterestJobId: pinterestJob.id,
			websiteId,
		},
	}).catch(() => null);

	await logWorkflowStep({
		ownerId,
		action: 'workflow.pinterest_queue',
		resourceType: 'pinterest_publish_jobs',
		resourceId: pinterestJob.id,
		metadata: {
			workflowId,
			status: jobStatus,
			waitingProvider,
		},
	});

	await logWorkflowStep({
		ownerId,
		action: 'workflow.completed',
		resourceType: 'publish_jobs',
		resourceId: job.id,
		metadata: {
			workflowId,
			wordpress: historyResult,
			pinterestJobId: pinterestJob.id,
			pinterestStatus: jobStatus,
		},
	});

	if (waitingProvider) {
		await notifyWorkspaceUser({
			ownerId,
			title: 'Pinterest job waiting for provider',
			body: 'Your pin is queued with Waiting Provider status until Pinterest Trial Access / credentials are ready.',
			priority: 'low',
			meta: {
				type: 'pinterest_waiting_provider',
				workflowId,
				jobId: pinterestJob.id,
			},
		});
	}

	return {
		pinterestJobId: pinterestJob.id,
		status: jobStatus,
		workflowId,
	};
}

/**
 * Promote WAITING_PROVIDER Pinterest jobs once OAuth + account + board are ready.
 */
export async function promoteWaitingProviderPinterestJobs({ limit = 20 } = {}) {
	const oauthReady = await isPinterestOAuthReady().catch(() => false);
	if (!oauthReady) return { promoted: 0, reason: 'oauth_not_ready' };

	const waiting = await pocketbaseClient.collection('pinterest_publish_jobs').getList(1, limit, {
		filter: 'status = "waiting_provider"',
		sort: 'created',
		requestKey: null,
	}).catch(() => ({ items: [] }));

	let promoted = 0;
	for (const job of waiting.items || []) {
		const account = await getOwnedPinterestAccount(job.owner).catch(() => null);
		if (!account?.connected || (account.status && account.status !== 'connected')) {
			continue;
		}
		const board = await getDefaultPinterestBoard({
			owner: job.owner,
			accountId: account.id,
		}).catch(() => null);
		if (!board?.board_id) continue;

		const scheduledAt = new Date().toISOString();
		const updatePayload = await sanitizeCollectionPayload({
			collection: 'pinterest_publish_jobs',
			context: 'publish-pipeline:promote-waiting',
			payload: {
				status: 'scheduled',
				scheduled_at: scheduledAt,
				board_id: board.board_id,
				board_name: board.name || '',
				account: account.id,
				account_label: account.label || account.username || '',
				account_username: account.username || '',
				last_error: '',
				next_retry_at: '',
			},
		});

		const updated = await pocketbaseClient.collection('pinterest_publish_jobs')
			.update(job.id, updatePayload)
			.catch(() => null);
		if (!updated) continue;

		await pocketbaseClient.collection('ai_pins').update(job.ai_pin, {
			status: 'scheduled',
			scheduled_at: scheduledAt,
			pinterest_board_id: board.board_id,
			pinterest_board_name: board.name || '',
			pinterest_account_id: account.id,
			publish_error: '',
		}).catch(() => null);

		await pocketbaseClient.collection('pinterest_publish_events').create({
			owner: job.owner,
			job: job.id,
			event_type: 'provider_ready',
			message: 'Pinterest credentials available — job promoted to scheduled',
			payload: { boardId: board.board_id },
		}).catch(() => null);

		await mirrorPinterestJob(updated, null, 'Pinterest provider ready — job scheduled').catch(() => null);

		await notifyWorkspaceUser({
			ownerId: job.owner,
			title: 'Pinterest credentials ready',
			body: 'A waiting Pinterest job was promoted and will publish automatically.',
			priority: 'normal',
			meta: { type: 'pinterest_provider_ready', jobId: job.id },
		});

		promoted += 1;
	}

	return { promoted };
}

export async function notifyWordpressPublishFailure({ job, error, retrying = false }) {
	await notifyWorkspaceUser({
		ownerId: job.owner,
		title: retrying ? 'WordPress publish retrying' : 'WordPress publish failed',
		body: error?.message || job.last_error || 'Unknown error',
		priority: retrying ? 'low' : 'high',
		meta: {
			type: retrying ? 'publish_retrying' : 'publish_failed',
			jobId: job.id,
			provider: 'wordpress',
			workflowId: workflowIdFor(job),
		},
	});

	await logWorkflowStep({
		ownerId: job.owner,
		action: retrying ? 'workflow.wordpress_retry' : 'workflow.wordpress_failed',
		result: 'error',
		resourceType: 'publish_jobs',
		resourceId: job.id,
		metadata: {
			workflowId: workflowIdFor(job),
			error: error?.message || '',
			attempt: Number(job.attempt_count || 0) + 1,
		},
	});
}

export function newWorkflowId() {
	return `wf-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

// re-export readiness helper used by callers
export { isPinterestOAuthReady, getPinterestAppCredentials };
