import { parseSyntheticId, makeSyntheticId } from '../admin-read/normalize.js';

export const CONTROL_ROUTE = Object.freeze({
	NATIVE: 'native',
	CHANNEL: 'channel',
});

export const CONTROL_TARGET_KIND = Object.freeze({
	NATIVE: 'native',
	MIRRORED: 'mirrored',
	CHANNEL_ONLY: 'channel-only',
});

/**
 * Pure classification for admin control routing (unit-testable).
 *
 * @param {{
 *   requestedId?: string,
 *   queueJob?: object|null,
 *   channelJob?: object|null,
 *   sourceCollection?: string,
 *   sourceId?: string,
 * }} input
 */
export function classifyControlTarget({
	requestedId = '',
	queueJob = null,
	channelJob = null,
	sourceCollection = '',
	sourceId = '',
} = {}) {
	const id = String(requestedId || '').trim();
	const collection = String(sourceCollection || queueJob?.source_collection || '').trim();
	const channelSourceId = String(sourceId || queueJob?.source_id || channelJob?.id || '').trim();

	if (collection && channelSourceId) {
		if (!channelJob) {
			return null;
		}
		const queueJobId = queueJob?.id || null;
		return {
			kind: queueJobId ? CONTROL_TARGET_KIND.MIRRORED : CONTROL_TARGET_KIND.CHANNEL_ONLY,
			route: CONTROL_ROUTE.CHANNEL,
			requestedId: id,
			queueJobId,
			sourceCollection: collection,
			sourceId: channelSourceId,
			syntheticId: makeSyntheticId(collection, channelSourceId),
			channelJob,
			queueJob,
		};
	}

	if (queueJob?.id && !String(queueJob.source_collection || '').trim()) {
		return {
			kind: CONTROL_TARGET_KIND.NATIVE,
			route: CONTROL_ROUTE.NATIVE,
			requestedId: id,
			queueJobId: queueJob.id,
			sourceCollection: '',
			sourceId: '',
			syntheticId: '',
			channelJob: null,
			queueJob,
		};
	}

	return null;
}

/**
 * Resolve source coordinates from a requested control id (pure).
 */
export function resolveControlCoordinates(requestedId) {
	const id = String(requestedId || '').trim();
	const synthetic = parseSyntheticId(id);
	if (synthetic) {
		return {
			requestedId: id,
			sourceCollection: synthetic.sourceCollection,
			sourceId: synthetic.sourceId,
			isSynthetic: true,
		};
	}
	return {
		requestedId: id,
		sourceCollection: '',
		sourceId: '',
		isSynthetic: false,
	};
}
