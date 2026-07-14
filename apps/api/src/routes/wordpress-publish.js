import pocketbaseClient from '../utils/pocketbaseClient.js';
import { decryptSecret } from '../utils/secretCrypto.js';

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

function requireString(value, fieldName) {
	if (typeof value !== 'string' || !value.trim()) {
		throw httpError(422, `${fieldName} is required`);
	}

	return value.trim();
}

async function getWebsiteForUser({ siteId, userId }) {
	if (!siteId || typeof siteId !== 'string') {
		throw httpError(422, 'siteId is required');
	}

	const site = await pocketbaseClient.collection('websites').getOne(siteId).catch(() => null);

	if (!site) {
		throw httpError(404, 'Website not found');
	}

	if (site.owner !== userId) {
		throw httpError(403, 'You do not have access to this website');
	}

	return site;
}

export default async (req, res) => {
	const {
		siteId,
		title,
		content,
		status,
		slug,
		excerpt,
	} = req.body ?? {};

	const site = await getWebsiteForUser({ siteId, userId: req.pocketbaseUserId });
	const safeTitle = requireString(title, 'title');
	const safeContent = requireString(content, 'content');
	const safeStatus = status === 'publish' ? 'publish' : 'draft';

	const { url, wp_username: username, wp_app_password: storedAppPassword } = site;
	const appPassword = decryptSecret(storedAppPassword);

	let base;
	try {
		base = new URL(url).origin;
	} catch {
		throw httpError(422, 'Invalid website URL');
	}

	const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');

	const response = await fetch(`${base}/wp-json/wp/v2/posts`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${auth}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
				title: safeTitle,
				content: safeContent,
				status: safeStatus,
				...(typeof slug === 'string' && slug.trim() ? { slug: slug.trim() } : {}),
				...(typeof excerpt === 'string' && excerpt.trim() ? { excerpt: excerpt.trim() } : {}),
		}),
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new Error(
			`WordPress publish failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`,
		);
	}

	const data = await response.json();
	res.json({ ok: true, id: data.id, link: data.link, status: data.status });
};
