/**
 * Capture live Template Engine gallery preview QA evidence.
 * Requires Vite on :3010.
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../../../docs/qa-evidence/live-previews');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(String(err)));
page.on('console', (msg) => {
	if (msg.type() === 'error') consoleErrors.push(msg.text());
});

const tNav = Date.now();
await page.goto('http://127.0.0.1:3010/qa-live-previews.html', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__LIVE_PREVIEW_QA__?.allFirstOk === true, null, { timeout: 300000 });
const firstLoadWallMs = Date.now() - tNav;
const report = await page.evaluate(() => window.__LIVE_PREVIEW_QA__);

await page.locator('#same-article').screenshot({ path: path.join(outDir, 'same-article-10.png') });
await page.locator('#demo-images').screenshot({ path: path.join(outDir, 'demo-different-images-10.png') });
await page.locator('#fallback').screenshot({ path: path.join(outDir, 'fallback-graceful.png') });
await page.screenshot({ path: path.join(outDir, 'page-overview.png'), fullPage: true });

const pinCount = await page.locator('#same-article .card img').count();
for (let i = 0; i < pinCount; i += 1) {
	await page.locator('#same-article .card').nth(i).screenshot({ path: path.join(outDir, `pin-${i + 1}.png`) });
}

// Re-open simulation: reload and measure cached path availability after re-render
const tReload = Date.now();
await page.reload({ waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__LIVE_PREVIEW_QA__?.allFirstOk === true, null, { timeout: 300000 });
const reopenMs = Date.now() - tReload;
const report2 = await page.evaluate(() => window.__LIVE_PREVIEW_QA__);

// Mobile viewport
const mobile = await browser.newPage({ ...devices['iPhone 13'] });
await mobile.goto('http://127.0.0.1:3010/qa-live-previews.html', { waitUntil: 'networkidle', timeout: 180000 });
await mobile.waitForFunction(() => window.__LIVE_PREVIEW_QA__?.allFirstOk === true, null, { timeout: 300000 });
await mobile.locator('#same-article').screenshot({ path: path.join(outDir, 'mobile-same-article-10.png') });
const mobileReport = await mobile.evaluate(() => window.__LIVE_PREVIEW_QA__);
await mobile.close();

// Scroll responsiveness: open desktop page, scroll while counting long tasks via rAF stutter proxy
await page.goto('http://127.0.0.1:3010/qa-live-previews.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
const scrollProbe = await page.evaluate(async () => {
	const start = performance.now();
	let frames = 0;
	let maxGap = 0;
	let last = performance.now();
	await new Promise((resolve) => {
		function tick(now) {
			frames += 1;
			maxGap = Math.max(maxGap, now - last);
			last = now;
			window.scrollBy(0, 40);
			if (performance.now() - start < 800) requestAnimationFrame(tick);
			else resolve();
		}
		requestAnimationFrame(tick);
	});
	return { frames, maxGap: Math.round(maxGap), durationMs: Math.round(performance.now() - start) };
});
await page.waitForFunction(() => window.__LIVE_PREVIEW_QA__, null, { timeout: 300000 });

const finalReport = {
	...report,
	firstLoadWallMs,
	reopenMs,
	reopenOk: report2?.allFirstOk === true,
	mobileOk: mobileReport?.allFirstOk === true,
	mobileBrokenImages: mobileReport?.brokenImages ?? null,
	scrollProbe,
	consoleErrors,
	outDir,
	files: fs.readdirSync(outDir),
};

fs.writeFileSync(path.join(outDir, 'LIVE_PREVIEW_QA_REPORT.json'), JSON.stringify(finalReport, null, 2));
console.log(JSON.stringify(finalReport, null, 2));
await browser.close();

const failed = !(
	finalReport.allFirstOk
	&& finalReport.noNearBlackWhite
	&& finalReport.brokenImages === 0
	&& finalReport.pinTitleLiteralInPage === false
	&& finalReport.uniqueDemoImages >= 4
	&& finalReport.reopenOk
	&& finalReport.mobileOk
	&& finalReport.consoleErrors.length === 0
);
process.exit(failed ? 2 : 0);
