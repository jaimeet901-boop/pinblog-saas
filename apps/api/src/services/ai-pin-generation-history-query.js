/**
 * Optional channel filter for GET /ai-pins/history (WS-06).
 * Always AND with workspaceScopeFilter via listWorkspaceResources extraFilter.
 * Never isolate generation history by userId or Facebook page ID.
 */
import { normalizeStudioPromptChannel } from './studio/prompt-packs.js';

export const GENERATION_HISTORY_CHANNELS = Object.freeze(['facebook', 'pinterest']);

/**
 * Parse optional ?channel=facebook|pinterest.
 * Missing / blank => no channel filter (existing behavior).
 * Unknown => 422 VALIDATION_ERROR.
 *
 * @param {unknown} value
 * @returns {'facebook' | 'pinterest' | null}
 */
export function parseGenerationHistoryChannel(value) {
	if (value == null) return null;
	const raw = String(value).trim();
	if (!raw) return null;
	const channel = raw.toLowerCase();
	if (channel !== 'facebook' && channel !== 'pinterest') {
		const error = new Error('channel must be facebook or pinterest');
		error.status = 422;
		error.errorCode = 'VALIDATION_ERROR';
		throw error;
	}
	return channel;
}

/**
 * PocketBase extraFilter for metadata.channel exact match.
 * Empty channel => no extra filter.
 *
 * @param {'facebook' | 'pinterest' | null | undefined} channel
 */
export function buildGenerationHistoryChannelFilter(channel) {
	if (!channel) return '';
	return `metadata.channel = "${channel}"`;
}

/**
 * @param {Record<string, unknown>} [query]
 */
export function resolveGenerationHistoryExtraFilter(query = {}) {
	return buildGenerationHistoryChannelFilter(parseGenerationHistoryChannel(query.channel));
}

/**
 * Stamp metadata.channel on future generation-history writes.
 * Explicit channel wins; facebook_* export profiles map to facebook.
 * Does not backfill missing channel.
 *
 * @param {{ channel?: unknown, exportProfileId?: unknown }} [input]
 * @returns {'facebook' | 'pinterest'}
 */
export function resolveGenerationHistoryWriteChannel({ channel, exportProfileId } = {}) {
	const explicit = String(channel || '').trim();
	if (explicit) return normalizeStudioPromptChannel(explicit);
	const profile = String(exportProfileId || '').trim().toLowerCase();
	if (profile.startsWith('facebook')) return 'facebook';
	return normalizeStudioPromptChannel(explicit);
}
