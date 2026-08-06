/**
 * Facebook Channel Pack — post-publish credit burn (F4-6).
 * Burns only after successful publish; idempotent per job id.
 */

export const FACEBOOK_PUBLISH_CREDIT_FEATURE = 'facebook_publish';

export function buildFacebookPublishCreditIdempotencyKey(jobId = '') {
	return `facebook-publish:${String(jobId || '').trim()}`;
}

/**
 * Burn workspace credits for a successfully published Facebook job.
 * No-op on failure when caller does not invoke this helper.
 *
 * @param {object} job
 * @param {{ facebookPostId?: string, deps?: object }} [options]
 */
export async function burnFacebookPublishCredits(job, { facebookPostId = '', deps = {} } = {}) {
	const owner = String(job?.owner || '').trim();
	const jobId = String(job?.id || '').trim();
	if (!owner || !jobId) return null;

	let consumeFeatureCredits = deps.consumeFeatureCredits;
	if (!consumeFeatureCredits) {
		({ consumeFeatureCredits } = await import('../ai-pin-credits.js'));
	}

	let workspaceKeyForUser = deps.workspaceKeyForUser;
	if (!workspaceKeyForUser) {
		({ workspaceKeyForUser } = await import('../workspace-context.js'));
	}

	const postId = String(facebookPostId || job.facebook_post_id || '').trim();

	return consumeFeatureCredits(deps.pocketbaseClient || null, {
		userId: owner,
		workspaceKey: String(job.workspace_key || job.workspaceKey || '').trim() || workspaceKeyForUser(owner),
		feature: FACEBOOK_PUBLISH_CREDIT_FEATURE,
		units: 1,
		reason: 'Facebook post published',
		referenceId: jobId,
		idempotencyKey: buildFacebookPublishCreditIdempotencyKey(jobId),
		metadata: {
			facebookPostId: postId,
			jobId,
		},
	}).catch(() => null);
}
