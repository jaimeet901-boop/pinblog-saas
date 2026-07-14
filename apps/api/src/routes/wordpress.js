import pocketbaseClient from '../utils/pocketbaseClient.js';
import { decryptSecret } from '../utils/secretCrypto.js';

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
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
	const { siteId } = req.body ?? {};
	const site = await getWebsiteForUser({ siteId, userId: req.pocketbaseUserId });

	const { url, wp_username: username, wp_app_password: storedAppPassword } = site;
	const appPassword = decryptSecret(storedAppPassword);

	let base;
	try {
		base = new URL(url).origin;
	} catch {
		throw httpError(422, 'Invalid website URL');
	}

	const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');

	let response;
	try {
		response = await fetch(`${base}/wp-json/wp/v2/users/me?context=edit`, {
			headers: { Authorization: `Basic ${auth}` },
		});
	} catch (err) {
		await pocketbaseClient.collection('websites').update(site.id, { status: 'failed' }).catch(() => {});
		return res.status(502).json({ ok: false, message: `Could not reach site: ${err.message}` });
	}

	if (!response.ok) {
		await pocketbaseClient.collection('websites').update(site.id, { status: 'failed' }).catch(() => {});
		return res.status(response.status).json({
			ok: false,
			message: `WordPress rejected the connection (${response.status} ${response.statusText})`,
		});
	}

	const data = await response.json().catch(() => ({}));
	await pocketbaseClient.collection('websites').update(site.id, { status: 'active' }).catch(() => {});

	res.json({
		ok: true,
		message: `Connected as ${data.name || username}`,
		user: { name: data.name, id: data.id, roles: data.roles },
	});
};
