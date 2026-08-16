/**
 * Pure dashboard publish-job rollup. Safe for unit tests (no PocketBase).
 */
export function summarizeDashboardPublishJobs({
	publishJobs = [],
	wordpressJobs = [],
	facebookJobs = [],
} = {}) {
	const publishedPins = publishJobs.filter((job) => job.status === 'published').length;
	const publishedWp = wordpressJobs.filter((job) => job.status === 'published' && job.wp_status !== 'future').length;
	const publishedFacebook = facebookJobs.filter((job) => job.status === 'published').length;
	const scheduledWp = wordpressJobs.filter((job) => (
		job.status === 'scheduled'
		|| (job.status === 'published' && (job.wp_status === 'future' || Boolean(job.scheduled_at)))
	)).length;
	const failedWp = wordpressJobs.filter((job) => job.status === 'failed').length;
	const failedPinJobs = publishJobs.filter((job) => job.status === 'failed').length;
	const failedFacebook = facebookJobs.filter((job) => job.status === 'failed').length;
	const scheduledPinJobs = publishJobs.filter((job) => job.status === 'scheduled' || job.status === 'publishing').length;
	const scheduledFacebook = facebookJobs.filter((job) => job.status === 'scheduled' || job.status === 'publishing').length;
	const pinterestWaiting = publishJobs.filter((job) => job.status === 'waiting_provider').length;
	const failedJobs = failedPinJobs + failedWp + failedFacebook;
	const scheduledJobs = scheduledPinJobs + scheduledWp + pinterestWaiting + scheduledFacebook;
	const publishedPosts = publishedPins + publishedWp + publishedFacebook;

	return {
		publishedPins,
		publishedWp,
		publishedFacebook,
		facebookPublications: publishedFacebook,
		failedJobs,
		scheduledJobs,
		publishedPosts,
		pinterestWaiting,
	};
}
