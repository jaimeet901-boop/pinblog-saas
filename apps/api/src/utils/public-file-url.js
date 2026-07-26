import pocketbaseClient from './pocketbaseClient.js';
import { getRequiredEnv } from './env.js';

/**
 * Browser-reachable PocketBase origin (nginx: /hcgi/platform → pocketbase:8090).
 * PB_BASE_URL stays internal for server→PocketBase traffic; never emit it to clients.
 */
export function getPublicPocketBaseOrigin() {
	const domain = getRequiredEnv('WEBSITE_DOMAIN').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
	return `https://${domain}/hcgi/platform`;
}

/**
 * Build a public file URL for a PocketBase file field.
 * Rewrites the internal PB_BASE_URL origin from files.getURL to the public proxy origin.
 *
 * @param {object} record
 * @param {string} filename
 * @returns {string}
 */
export function getPublicFileUrl(record, filename) {
	if (!filename) {
		throw new Error('getPublicFileUrl requires a filename');
	}

	const internalUrl = pocketbaseClient.files.getURL(record, filename);
	const publicOrigin = getPublicPocketBaseOrigin();
	const publicUrl = String(internalUrl).replace(/^https?:\/\/[^/]+/i, publicOrigin);

	let parsed;
	try {
		parsed = new URL(publicUrl);
	} catch {
		throw new Error(`getPublicFileUrl produced an invalid URL: ${publicUrl}`);
	}

	const host = parsed.hostname.toLowerCase();
	if (
		host === 'pocketbase'
		|| host === 'localhost'
		|| host === '127.0.0.1'
		|| host.endsWith('.internal')
		|| host.endsWith('.local')
	) {
		throw new Error(`getPublicFileUrl refused internal host: ${host}`);
	}

	return publicUrl;
}
