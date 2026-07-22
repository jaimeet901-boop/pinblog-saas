/**
 * Publishing provider abstraction.
 * Current implementation wraps the existing Pinterest queue/API without changing behavior.
 */

export class PublishProvider {
	/**
	 * @param {object} pin
	 * @param {object} options
	 */
	async publish(pin, options = {}) {
		throw new Error('publish() not implemented');
	}

	/**
	 * @param {object} pin
	 * @param {object} options
	 */
	async schedule(pin, options = {}) {
		throw new Error('schedule() not implemented');
	}

	/**
	 * @param {string} jobId
	 */
	async getStatus(jobId) {
		throw new Error('getStatus() not implemented');
	}
}

export class PinterestPublishProvider extends PublishProvider {
	constructor({ createJobs }) {
		super();
		this.createJobs = createJobs;
	}

	async publish(pins, options = {}) {
		return this.createJobs({
			pins,
			mode: 'publish',
			...options,
		});
	}

	async schedule(pins, options = {}) {
		return this.createJobs({
			pins,
			mode: 'schedule',
			...options,
		});
	}

	async getStatus(job) {
		return {
			id: job?.id || '',
			status: job?.status || 'unknown',
			provider: 'pinterest',
			error: job?.last_error || '',
			publishedAt: job?.published_at || '',
			pinUrl: job?.pinterest_pin_url || '',
		};
	}
}

let defaultProvider = null;

export function getPublishProvider() {
	if (!defaultProvider) {
		defaultProvider = new PinterestPublishProvider({
			createJobs: async () => {
				throw new Error('PinterestPublishProvider createJobs bridge is not configured');
			},
		});
	}
	return defaultProvider;
}

export function setPublishProvider(provider) {
	defaultProvider = provider;
}

export function listPublishProviders() {
	return [
		{
			id: 'pinterest',
			label: 'Pinterest',
			status: 'active',
			notes: 'Wired to createPublishJobs + the Pinterest OAuth/publish queue.',
		},
		{
			id: 'wordpress',
			label: 'WordPress',
			status: 'active',
			notes: 'Queued via publish_jobs + wordpress-publish-queue with encrypted credentials.',
		},
	];
}

export class WordpressPublishProvider extends PublishProvider {
	constructor({ enqueue }) {
		super();
		this.enqueue = enqueue;
	}

	async publish(payload, options = {}) {
		return this.enqueue({ ...payload, ...options, status: payload?.status || 'publish' });
	}

	async schedule(payload, options = {}) {
		return this.enqueue({
			...payload,
			...options,
			status: 'future',
			scheduledAt: options.scheduledAt || payload?.scheduledAt,
		});
	}

	async getStatus(job) {
		return {
			id: job?.id || '',
			status: job?.status || 'unknown',
			provider: 'wordpress',
			error: job?.lastError || job?.last_error || '',
			publishedAt: job?.completedAt || job?.completed_at || '',
			postUrl: job?.wpPostUrl || job?.wp_post_url || '',
		};
	}
}
