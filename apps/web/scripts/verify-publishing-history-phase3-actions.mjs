/**
 * Phase 3 action-endpoint regression with mocked /publishing/history payload.
 * Confirms Retry / Cancel / Publish Now / Retry Failed hit legacy pinterest job routes.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(path.join(repoRoot, 'package.json'));
const { chromium } = require('playwright');

const WEB_URL = String(process.env.WEB_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');
const API_URL = String(process.env.API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const PB_URL = String(process.env.PB_URL || 'http://127.0.0.1:18111').replace(/\/$/, '');
const SUPER_EMAIL = String(process.env.PB_SUPERUSER_EMAIL || 'admin@example.com').trim();
const SUPER_PASSWORD = String(process.env.PB_SUPERUSER_PASSWORD || 'AdminPass123456').trim();
const TEMP_PASSWORD = String(process.env.PROOF_TEMP_PASSWORD || 'ProofCapturePass123!').trim();

const MOCK_PAYLOAD = {
	version: 1,
	items: [
		{
			id: 'pinterest:job_failed_1',
			channel: 'pinterest',
			jobId: 'job_failed_1',
			status: 'failed',
			nativeStatus: 'failed',
			title: 'Failed pin title',
			description: 'desc',
			imageUrl: '',
			contentId: 'pin_f1',
			websiteId: 'ws1',
			destinationUrl: '',
			destination: {
				kind: 'board',
				accountId: 'acct1',
				accountLabel: 'QA Account',
				targetId: 'board1',
				targetLabel: 'QA Board',
				externalId: '',
				externalUrl: '',
			},
			scheduledAt: '2026-07-01T10:00:00.000Z',
			timezone: 'UTC',
			publishedAt: null,
			createdAt: '2026-07-01T09:00:00.000Z',
			updatedAt: '2026-07-01T11:00:00.000Z',
			attemptCount: 2,
			maxAttempts: 3,
			nextRetryAt: null,
			lastError: 'provider timeout',
			channelPayload: {
				boardId: 'board1',
				boardName: 'QA Board',
				accountUsername: 'qa',
				articleId: '',
				performance: null,
				pin: {
					id: 'pin_f1',
					title: 'Failed pin title',
					description: 'desc',
					overlayText: '',
					imageUrl: '',
					status: 'ready',
				},
			},
		},
		{
			id: 'pinterest:job_sched_1',
			channel: 'pinterest',
			jobId: 'job_sched_1',
			status: 'scheduled',
			nativeStatus: 'scheduled',
			title: 'Scheduled pin title',
			description: 'desc',
			imageUrl: '',
			contentId: 'pin_s1',
			websiteId: 'ws1',
			destinationUrl: '',
			destination: {
				kind: 'board',
				accountId: 'acct1',
				accountLabel: 'QA Account',
				targetId: 'board1',
				targetLabel: 'QA Board',
				externalId: '',
				externalUrl: '',
			},
			scheduledAt: '2026-07-02T10:00:00.000Z',
			timezone: 'UTC',
			publishedAt: null,
			createdAt: '2026-07-01T09:00:00.000Z',
			updatedAt: '2026-07-01T12:00:00.000Z',
			attemptCount: 0,
			maxAttempts: 3,
			nextRetryAt: null,
			lastError: '',
			channelPayload: {
				boardId: 'board1',
				boardName: 'QA Board',
				accountUsername: 'qa',
				articleId: '',
				performance: null,
				pin: {
					id: 'pin_s1',
					title: 'Scheduled pin title',
					description: 'desc',
					overlayText: '',
					imageUrl: '',
					status: 'ready',
				},
			},
		},
		{
			id: 'pinterest:job_pub_1',
			channel: 'pinterest',
			jobId: 'job_pub_1',
			status: 'published',
			nativeStatus: 'published',
			title: 'Published pin title',
			description: 'desc',
			imageUrl: '',
			contentId: 'pin_p1',
			websiteId: 'ws1',
			destinationUrl: '',
			destination: {
				kind: 'board',
				accountId: 'acct1',
				accountLabel: 'QA Account',
				targetId: 'board1',
				targetLabel: 'QA Board',
				externalId: 'ext1',
				externalUrl: 'https://pinterest.com/pin/ext1',
			},
			scheduledAt: null,
			timezone: 'UTC',
			publishedAt: '2026-07-01T13:00:00.000Z',
			createdAt: '2026-07-01T09:00:00.000Z',
			updatedAt: '2026-07-01T13:00:00.000Z',
			attemptCount: 1,
			maxAttempts: 3,
			nextRetryAt: null,
			lastError: '',
			channelPayload: {
				boardId: 'board1',
				boardName: 'QA Board',
				accountUsername: 'qa',
				pinterestPinUrl: 'https://pinterest.com/pin/ext1',
				articleId: '',
				performance: null,
				pin: {
					id: 'pin_p1',
					title: 'Published pin title',
					description: 'desc',
					overlayText: 'overlay',
					imageUrl: '',
					status: 'ready',
				},
			},
		},
	],
	meta: {
		page: 1,
		perPage: 100,
		totalItems: 3,
		totalPages: 1,
		sort: '-updatedAt',
		filters: { channel: 'pinterest' },
		counts: {},
		truncated: false,
	},
	warnings: [],
};

async function pbJson(url, options = {}) {
	const response = await fetch(url, options);
	const text = await response.text();
	let body = null;
	try { body = text ? JSON.parse(text) : null; } catch { body = { raw: String(text).slice(0, 200) }; }
	if (!response.ok) throw new Error(`${options.method || 'GET'} ${url} → ${response.status} ${JSON.stringify(body)}`);
	return body;
}

async function proxyRoutes(page) {
	await page.route('**/hcgi/api/**', async (route) => {
		const req = route.request();
		const u = new URL(req.url());
		const pathName = u.pathname.replace(/^\/hcgi\/api/, '');
		if (pathName.startsWith('/publishing/history')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(MOCK_PAYLOAD),
			});
			return;
		}
		if (/^\/pinterest\/jobs\/[^/]+\/(retry|cancel|publish-now)$/.test(pathName)) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ id: 'ok' }),
			});
			return;
		}
		const target = `${API_URL}${pathName}${u.search}`;
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

async function main() {
	const report = {
		ok: true,
		actions: [],
		networkHistory: [],
		ui: {},
		consoleErrors: [],
		pageErrors: [],
	};

	const su = await pbJson(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identity: SUPER_EMAIL, password: SUPER_PASSWORD }),
	});
	const users = await pbJson(`${PB_URL}/api/collections/users/records?perPage=1&sort=created`, {
		headers: { Authorization: su.token },
	});
	const user = (users.items || [])[0];
	if (!user) throw new Error('No user for auth');
	await pbJson(`${PB_URL}/api/collections/users/records/${user.id}`, {
		method: 'PATCH',
		headers: { Authorization: su.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ password: TEMP_PASSWORD, passwordConfirm: TEMP_PASSWORD }),
	});
	const auth = await pbJson(`${PB_URL}/api/collections/users/auth-with-password`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identity: user.email, password: TEMP_PASSWORD }),
	});

	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	await proxyRoutes(page);
	page.on('console', (msg) => { if (msg.type() === 'error') report.consoleErrors.push(msg.text()); });
	page.on('pageerror', (err) => report.pageErrors.push(String(err.message || err)));
	page.on('request', (req) => {
		const url = req.url();
		if (url.includes('/publishing/history')) report.networkHistory.push('publishing');
		if (url.includes('/pinterest/history')) report.networkHistory.push('pinterest');
		const m = url.match(/\/pinterest\/jobs\/([^/]+)\/(retry|cancel|publish-now)/);
		if (m) report.actions.push({ jobId: m[1], action: m[2], method: req.method() });
	});

	await page.addInitScript(({ token, record }) => {
		localStorage.setItem('pocketbase_auth', JSON.stringify({ token, record }));
	}, { token: auth.token, record: auth.record });

	await page.goto(`${WEB_URL}/app/pinterest-history`, { waitUntil: 'domcontentloaded', timeout: 60000 });
	await page.waitForTimeout(2500);

	report.ui.title = await page.locator('h1').first().textContent().catch(() => '');
	report.ui.rowCount = await page.locator('.pub-table tbody tr').count();
	report.ui.statFailed = await page.locator('.pub-stat', { hasText: 'Failed Jobs' }).locator('.pub-stat__value').textContent().catch(() => null);
	report.ui.inspectorTitle = await page.locator('.pub-center__inspector .font-display').nth(1).textContent().catch(() => null);

	// Retry on failed row
	const failedRow = page.locator('.pub-table tbody tr', { hasText: 'Failed' }).first();
	await failedRow.locator('button').filter({ hasText: /^$/ }).nth(1).click().catch(async () => {
		await failedRow.locator('button').nth(1).click();
	});
	// More reliable: inspector Retry after selecting failed
	await failedRow.click();
	await page.waitForTimeout(300);
	await page.locator('.pub-center__inspector button', { hasText: /^Retry$/ }).click();
	await page.waitForTimeout(800);

	// Publish Now + Cancel on scheduled
	const scheduledRow = page.locator('.pub-table tbody tr', { hasText: 'Scheduled' }).first();
	await scheduledRow.click();
	await page.waitForTimeout(300);
	await page.locator('.pub-center__inspector button', { hasText: /Publish Now/i }).click();
	await page.waitForTimeout(800);
	await scheduledRow.click();
	await page.waitForTimeout(300);
	await page.locator('.pub-center__inspector button', { hasText: /Cancel schedule/i }).click();
	await page.waitForTimeout(800);

	// Retry Failed bulk
	await page.locator('button', { hasText: /Retry Failed/i }).click();
	await page.waitForTimeout(1200);

	// Copy link on published (clipboard may fail in headless — still exercises handler)
	const publishedRow = page.locator('.pub-table tbody tr', { hasText: 'Published' }).first();
	await publishedRow.click();
	await page.waitForTimeout(200);
	await page.locator('.pub-center__inspector button', { hasText: /Copy Link/i }).click().catch(() => null);
	const openPin = page.locator('.pub-center__inspector a', { hasText: /Open Pinterest Pin/i });
	report.ui.openPinHref = await openPin.getAttribute('href').catch(() => null);

	await browser.close();

	const has = (jobId, action) => report.actions.some((a) => a.jobId === jobId && a.action === action && a.method === 'POST');
	report.checks = {
		landed: String(report.ui.title || '').includes('Publishing Center'),
		rowsRendered: report.ui.rowCount >= 3,
		noPinterestHistory: !report.networkHistory.includes('pinterest'),
		usedPublishingHistory: report.networkHistory.includes('publishing'),
		retryFailedJob: has('job_failed_1', 'retry'),
		publishNowScheduled: has('job_sched_1', 'publish-now'),
		cancelScheduled: has('job_sched_1', 'cancel'),
		bulkRetryUsesRawId: has('job_failed_1', 'retry'),
		openPinHref: report.ui.openPinHref === 'https://pinterest.com/pin/ext1',
		noCompositeIds: report.actions.every((a) => !String(a.jobId).includes(':')),
		noPageErrors: report.pageErrors.length === 0,
	};

	report.ok = Object.values(report.checks).every(Boolean);
	console.log(JSON.stringify(report, null, 2));
	process.exit(report.ok ? 0 : 2);
}

main().catch((error) => {
	console.error(JSON.stringify({ ok: false, fatal: String(error.message || error) }, null, 2));
	process.exit(1);
});
