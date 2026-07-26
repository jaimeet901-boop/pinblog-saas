/**
 * Verify Choose Template gallery via API for two brand-new accounts.
 */
import { Buffer } from 'node:buffer';
import fs from 'node:fs';

const PB = 'http://127.0.0.1:18111';
const API = 'http://127.0.0.1:3001';

async function pbJson(path, { method = 'GET', body } = {}) {
	const res = await fetch(`${PB}${path}`, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	});
	const payload = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(payload.message || `${res.status}`);
	return payload;
}

function toApiBearer(auth) {
	return Buffer.from(JSON.stringify({ token: auth.token, record: auth.record }), 'utf8').toString('base64');
}

async function registerUser(label) {
	const stamp = Date.now() + Math.floor(Math.random() * 999);
	const email = `qa.api.${label}.${stamp}@example.com`;
	const password = `QaPass${stamp}Xx`;
	await pbJson('/api/collections/users/records', {
		method: 'POST',
		body: { email, password, passwordConfirm: password, name: `QA API ${label}` },
	});
	const auth = await pbJson('/api/collections/users/auth-with-password', {
		method: 'POST',
		body: { identity: email, password },
	});
	return { id: auth.record.id, bearer: toApiBearer(auth) };
}

async function gallery(user) {
	const res = await fetch(`${API}/workspace/v1/templates?view=gallery&status=published&perPage=50`, {
		headers: { Authorization: `Bearer ${user.bearer}` },
	});
	const payload = await res.json().catch(() => ({}));
	return { status: res.status, payload };
}

const userA = await registerUser('alpha');
const userB = await registerUser('bravo');
const a = await gallery(userA);
const b = await gallery(userB);

const itemsA = a.payload.items || [];
const itemsB = b.payload.items || [];
const officialA = itemsA.filter((i) => i.visibility === 'official');
const officialB = itemsB.filter((i) => i.visibility === 'official');
const uuidsA = officialA.map((i) => i.templateUuid || i.template_uuid).filter(Boolean);
const uuidsB = officialB.map((i) => i.templateUuid || i.template_uuid).filter(Boolean);

const report = {
	userA: userA.id,
	userB: userB.id,
	statusA: a.status,
	statusB: b.status,
	errorA: a.status !== 200 ? a.payload : undefined,
	errorB: b.status !== 200 ? b.payload : undefined,
	countA: officialA.length,
	countB: officialB.length,
	totalA: a.payload.totalItems,
	totalB: b.payload.totalItems,
	uuidUniqueA: new Set(uuidsA).size,
	uuidUniqueB: new Set(uuidsB).size,
	sameSet: JSON.stringify([...uuidsA].sort()) === JSON.stringify([...uuidsB].sort()),
	allPublished: officialA.every((i) => !i.status || i.status === 'published')
		&& officialB.every((i) => !i.status || i.status === 'published'),
	categories: [...new Set(officialA.map((i) => i.category))].sort(),
};

fs.writeFileSync('docs/qa-evidence/official-templates/new-user-api-gallery.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.statusA !== 200 || report.statusB !== 200 || report.countA !== 24 || report.countB !== 24 || !report.sameSet) {
	process.exitCode = 2;
}
