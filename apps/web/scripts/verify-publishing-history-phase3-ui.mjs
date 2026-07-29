/**
 * Phase 3 UI/network smoke — authenticates like existing proof harnesses,
 * opens Publishing Center, asserts network + shell structure.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(path.join(repoRoot, 'package.json'));
const { chromium } = require('playwright');

const {
	adaptPublishingHistoryResponse,
} = await import(pathToFileURL(path.join(__dirname, '../src/services/publishing-history/uiAdapter.js')).href);

const WEB_URL = String(process.env.WEB_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');
const API_URL = String(process.env.API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const PB_URL = String(process.env.PB_URL || 'http://127.0.0.1:18111').replace(/\/$/, '');
const SUPER_EMAIL = String(process.env.PB_SUPERUSER_EMAIL || 'admin@example.com').trim();
const SUPER_PASSWORD = String(process.env.PB_SUPERUSER_PASSWORD || 'AdminPass123456').trim();
const TEMP_PASSWORD = String(process.env.PROOF_TEMP_PASSWORD || 'ProofCapturePass123!').trim();

async function pbJson(url, options = {}) {
	const response = await fetch(url, options);
	const text = await response.text();
	let body = null;
	try { body = text ? JSON.parse(text) : null; } catch { body = { raw: String(text).slice(0, 200) }; }
	if (!response.ok) throw new Error(`${options.method || 'GET'} ${url} → ${response.status} ${JSON.stringify(body)}`);
	return body;
}

async function findOwnerWithWebsite(superToken) {
	const headers = { Authorization: superToken };
	const sites = await pbJson(`${PB_URL}/api/collections/websites/records?perPage=50&sort=-created`, { headers });
	for (const site of sites.items || []) {
		const owner = typeof site.owner === 'string' ? site.owner : site.owner?.id || '';
		if (owner) return { ownerId: owner, websiteId: site.id };
	}
	const users = await pbJson(`${PB_URL}/api/collections/users/records?perPage=1&sort=created`, { headers });
	const user = (users.items || [])[0];
	if (!user) throw new Error('No users available for smoke auth');
	return { ownerId: user.id, websiteId: '' };
}

async function authAsOwner(superToken, ownerId) {
	const headers = { Authorization: superToken, 'Content-Type': 'application/json' };
	const user = await pbJson(`${PB_URL}/api/collections/users/records/${ownerId}`, { headers });
	await pbJson(`${PB_URL}/api/collections/users/records/${ownerId}`, {
		method: 'PATCH',
		headers,
		body: JSON.stringify({ password: TEMP_PASSWORD, passwordConfirm: TEMP_PASSWORD }),
	});
	const auth = await pbJson(`${PB_URL}/api/collections/users/auth-with-password`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identity: user.email, password: TEMP_PASSWORD }),
	});
	return auth;
}

async function proxyRoutes(page) {
	await page.route('**/hcgi/api/**', async (route) => {
		const req = route.request();
		const u = new URL(req.url());
		const target = `${API_URL}${u.pathname.replace(/^\/hcgi\/api/, '')}${u.search}`;
		const headers = { ...req.headers() };
		delete headers.host;
		const init = { method: req.method(), headers };
		if (req.method() !== 'GET' && req.method() !== 'HEAD') init.body = req.postDataBuffer();
		const res = await fetch(target, init);
		const buf = Buffer.from(await res.arrayBuffer());
		const outHeaders = {};
		res.headers.forEach((v, k) => {
			if (k.toLowerCase() === 'transfer-encoding') return;
			outHeaders[k] = v;
		});
		await route.fulfill({ status: res.status, headers: outHeaders, body: buf });
	});
	await page.route('**/hcgi/platform/**', async (route) => {
		const req = route.request();
		const u = new URL(req.url());
		const target = `${PB_URL}${u.pathname.replace(/^\/hcgi\/platform/, '')}${u.search}`;
		const headers = { ...req.headers() };
		delete headers.host;
		const init = { method: req.method(), headers };
		if (req.method() !== 'GET' && req.method() !== 'HEAD') init.body = req.postDataBuffer();
		const res = await fetch(target, init);
		const buf = Buffer.from(await res.arrayBuffer());
		const outHeaders = {};
		res.headers.forEach((v, k) => {
			if (k.toLowerCase() === 'transfer-encoding') return;
			outHeaders[k] = v;
		});
		await route.fulfill({ status: res.status, headers: outHeaders, body: buf });
	});
}

function uiSlice(row) {
	return {
		id: row.id,
		status: String(row.status || ''),
		accountLabel: String(row.accountLabel || ''),
		boardName: String(row.boardName || ''),
		websiteId: String(row.websiteId || ''),
		pinterestPinUrl: String(row.pinterestPinUrl || ''),
		pinTitle: String(row.pin?.title || ''),
		lastError: String(row.lastError || ''),
		canOpenArticle: Boolean(row.pin?.destinationUrl || row.destinationUrl),
	};
}

async function main() {
	const report = {
		ok: true,
		checks: {},
		network: { publishingHistory: [], pinterestHistory: [], actions: [] },
		consoleErrors: [],
		pageErrors: [],
		apiParity: null,
		ui: {},
	};

	const su = await pbJson(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identity: SUPER_EMAIL, password: SUPER_PASSWORD }),
	});
	const target = await findOwnerWithWebsite(su.token);
	const auth = await authAsOwner(su.token, target.ownerId);
	const bearer = Buffer.from(JSON.stringify({ token: auth.token, record: auth.record })).toString('base64');
	const apiHeaders = { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' };

	// Dual-endpoint parity (no X-Workspace-Id → personal workspace resolve)
	const [legacyRes, pubRes] = await Promise.all([
		fetch(`${API_URL}/pinterest/history?page=1&perPage=100`, { headers: apiHeaders }),
		fetch(`${API_URL}/publishing/history?page=1&perPage=100&channel=pinterest&sort=-updatedAt`, { headers: apiHeaders }),
	]);
	const legacyJson = await legacyRes.json().catch(() => ({}));
	const pubJson = await pubRes.json().catch(() => ({}));
	report.checks.legacyHttp = legacyRes.status;
	report.checks.publishingHttp = pubRes.status;
	report.checks.legacyIntact = legacyRes.status === 200 || legacyRes.status === 401;
	if (legacyRes.ok && pubRes.ok) {
		const adapted = adaptPublishingHistoryResponse(pubJson, { applyDefaultStatusFilter: true });
		const legacyItems = (legacyJson.items || []).map(uiSlice);
		const adaptedItems = (adapted.items || []).map(uiSlice);
		const diffs = [];
		const adaptedById = new Map(adaptedItems.map((i) => [i.id, i]));
		for (const leg of legacyItems) {
			const ad = adaptedById.get(leg.id);
			if (!ad) {
				diffs.push({ id: leg.id, type: 'missingInAdapted' });
				continue;
			}
			for (const key of Object.keys(leg)) {
				if (String(leg[key]) !== String(ad[key])) {
					diffs.push({ id: leg.id, field: key, legacy: leg[key], adapted: ad[key] });
				}
			}
		}
		for (const ad of adaptedItems) {
			if (!legacyItems.some((l) => l.id === ad.id)) diffs.push({ id: ad.id, type: 'extraInAdapted' });
		}
		report.apiParity = {
			legacyCount: legacyItems.length,
			adaptedCount: adaptedItems.length,
			idOrderMatch: JSON.stringify(legacyItems.map((i) => i.id)) === JSON.stringify(adaptedItems.map((i) => i.id)),
			diffs,
		};
		if (diffs.length) report.ok = false;
	} else {
		report.ok = false;
		report.apiParity = { error: { legacy: legacyJson?.message || legacyRes.status, publishing: pubJson?.message || pubRes.status } };
	}

	// Unauth legacy probe for backward compatibility
	const unauthLegacy = await fetch(`${API_URL}/pinterest/history?perPage=1`);
	report.checks.legacyUnauthStatus = unauthLegacy.status;
	report.checks.legacyEndpointPresent = unauthLegacy.status !== 404;

	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	await proxyRoutes(page);

	page.on('console', (msg) => {
		if (msg.type() === 'error') {
			const text = msg.text();
			// Ignore noisy workspace polling during boot if page still renders
			report.consoleErrors.push(text);
		}
	});
	page.on('pageerror', (err) => report.pageErrors.push(String(err.message || err)));
	page.on('request', (req) => {
		const url = req.url();
		if (url.includes('/publishing/history')) {
			report.network.publishingHistory.push(url.replace(/^.*\/hcgi\/api/, '').replace(API_URL, ''));
		}
		if (url.includes('/pinterest/history')) {
			report.network.pinterestHistory.push(url.replace(/^.*\/hcgi\/api/, '').replace(API_URL, ''));
		}
		if (/\/pinterest\/jobs\/[^/]+\/(retry|cancel|publish-now)/.test(url)) {
			report.network.actions.push({ method: req.method(), path: url.replace(/^.*\/hcgi\/api/, '').replace(API_URL, '') });
		}
	});

	await page.addInitScript(({ token, record }) => {
		localStorage.setItem('pocketbase_auth', JSON.stringify({ token, record }));
	}, { token: auth.token, record: auth.record });

	await page.goto(`${WEB_URL}/app/pinterest-history`, { waitUntil: 'domcontentloaded', timeout: 90000 });
	await page.waitForTimeout(3500);

	const title = await page.locator('h1').first().textContent().catch(() => '');
	report.ui.title = title;
	report.ui.landed = String(title || '').includes('Publishing Center');
	report.ui.hasStats = (await page.locator('.pub-center__stats .pub-stat').count()) >= 5;
	report.ui.hasQuickFilters = (await page.locator('.pub-chip').count()) >= 6;
	report.ui.hasInspector = (await page.locator('.pub-center__inspector').count()) === 1;
	report.ui.hasSearch = (await page.locator('input[placeholder*="Search"]').count()) >= 1;
	report.ui.hasStatusFilter = (await page.locator('select').count()) >= 1;
	report.ui.hasRetryFailed = (await page.locator('button', { hasText: 'Retry Failed' }).count()) >= 1;
	report.ui.hasRefresh = (await page.locator('button', { hasText: 'Refresh' }).count()) >= 1;
	report.ui.emptyOrRows = (await page.locator('.pub-empty, .pub-table tbody tr, .pub-card').count()) > 0;
	report.ui.actionIcons = {
		eye: (await page.locator('.pub-row-actions, .pub-center__actions').count()) > 0,
	};

	// Client filters / empty state still interactive
	if (report.ui.landed) {
		await page.locator('.pub-chip', { hasText: 'Failed' }).click().catch(() => null);
		await page.waitForTimeout(600);
		await page.locator('.pub-chip', { hasText: 'All' }).click().catch(() => null);
		await page.waitForTimeout(600);
		const search = page.locator('input[placeholder*="Search"]').first();
		if (await search.count()) {
			await search.fill('zzz-no-match-phase3');
			await page.waitForTimeout(300);
			report.ui.searchEmpty = (await page.locator('.pub-empty').count()) > 0
				|| (await page.locator('.pub-table tbody tr').count()) === 0;
			await search.fill('');
		}
	}

	await browser.close();

	report.checks.onlyPublishingHistory = report.network.pinterestHistory.length === 0
		&& report.network.publishingHistory.length >= 1;
	report.checks.publishingQueryHasChannel = report.network.publishingHistory.some((u) => u.includes('channel=pinterest'));
	report.checks.noPageErrors = report.pageErrors.length === 0;
	// Filter console to hard failures only (undefined access / React invariants)
	report.hardConsoleErrors = report.consoleErrors.filter((t) =>
		/undefined|TypeError|React|Cannot read/i.test(t) && !/Workspace not found/i.test(t));
	report.checks.noHardConsoleErrors = report.hardConsoleErrors.length === 0;

	if (!report.ui.landed) report.ok = false;
	if (!report.checks.onlyPublishingHistory) report.ok = false;
	if (!report.checks.publishingQueryHasChannel) report.ok = false;
	if (!report.checks.legacyEndpointPresent) report.ok = false;
	if (!report.checks.noPageErrors) report.ok = false;
	if (!report.checks.noHardConsoleErrors) report.ok = false;
	if (!report.ui.hasStats || !report.ui.hasQuickFilters || !report.ui.hasInspector) report.ok = false;

	console.log(JSON.stringify(report, null, 2));
	process.exit(report.ok ? 0 : 2);
}

main().catch((error) => {
	console.error(JSON.stringify({ ok: false, fatal: String(error.message || error) }, null, 2));
	process.exit(1);
});
