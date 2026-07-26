/**
 * Live gallery QA for brand-new users.
 */
import { Buffer } from 'node:buffer';
import fs from 'node:fs';

// Force QA PocketBase (do not inherit stale shell env).
process.env.PB_BASE_URL = process.env.PB_BASE_URL || 'http://127.0.0.1:18111';
if (!process.env.PB_SUPERUSER_EMAIL || !process.env.PB_SUPERUSER_PASSWORD) {
	throw new Error('Set PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD for seed QA');
}

const PB = process.env.PB_BASE_URL;

async function pbJson(path, { method = 'GET', body, token } = {}) {
	const headers = { 'Content-Type': 'application/json' };
	if (token) headers.Authorization = token;
	const res = await fetch(`${PB}${path}`, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});
	const payload = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(payload.message || `${method} ${path} -> ${res.status}`);
	}
	return payload;
}

async function registerUser(label) {
	const stamp = Date.now() + Math.floor(Math.random() * 1000);
	const email = `qa.${label}.${stamp}@example.com`;
	const password = `QaPass${stamp}Xx`;
	await pbJson('/api/collections/users/records', {
		method: 'POST',
		body: { email, password, passwordConfirm: password, name: `QA ${label}` },
	});
	const auth = await pbJson('/api/collections/users/auth-with-password', {
		method: 'POST',
		body: { identity: email, password },
	});
	return { email, id: auth.record.id, token: auth.token };
}

async function listOfficial(user) {
	const filter = encodeURIComponent('(visibility = "official") && (deleted_at = "" || deleted_at = null) && (status = "published" || status = "")');
	try {
		return await pbJson(`/api/collections/ai_pin_templates/records?page=1&perPage=50&filter=${filter}`, {
			token: user.token,
		});
	} catch (error) {
		// Fallback without deleted_at if field optional
		const filter2 = encodeURIComponent('visibility = "official" && (status = "published" || status = "")');
		return await pbJson(`/api/collections/ai_pin_templates/records?page=1&perPage=50&filter=${filter2}`, {
			token: user.token,
		});
	}
}

async function main() {
	const health = await fetch(`${PB}/api/health`, { method: 'HEAD' });
	if (!health.ok) throw new Error('PB QA instance not healthy');

	const userA = await registerUser('alpha');
	const userB = await registerUser('bravo');

	const { ensureOfficialPinTemplatesSeeded } = await import('../apps/api/src/services/official-pin-templates-seed.js');
	const seed = await ensureOfficialPinTemplatesSeeded();

	const listA = await listOfficial(userA);
	const listB = await listOfficial(userB);
	const itemsA = listA.items || [];
	const itemsB = listB.items || [];
	const uuidsA = itemsA.map((i) => i.template_uuid).filter(Boolean);
	const uuidsB = itemsB.map((i) => i.template_uuid).filter(Boolean);

	const report = {
		pb: PB,
		seed,
		userA: { id: userA.id },
		userB: { id: userB.id },
		countA: itemsA.length,
		countB: itemsB.length,
		totalItemsA: listA.totalItems,
		totalItemsB: listB.totalItems,
		uuidUniqueA: new Set(uuidsA).size,
		uuidUniqueB: new Set(uuidsB).size,
		allPublishedA: itemsA.every((i) => !i.status || i.status === 'published'),
		allOfficialA: itemsA.every((i) => i.visibility === 'official'),
		sameSet: JSON.stringify([...uuidsA].sort()) === JSON.stringify([...uuidsB].sort()),
		categories: [...new Set(itemsA.map((i) => i.category))].sort(),
		names: itemsA.map((i) => i.name),
	};

	fs.mkdirSync('docs/qa-evidence/official-templates', { recursive: true });
	fs.writeFileSync('docs/qa-evidence/official-templates/new-user-gallery.json', JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
	if (report.countA !== 24 || report.countB !== 24 || !report.sameSet || report.uuidUniqueA !== 24) {
		process.exitCode = 2;
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
