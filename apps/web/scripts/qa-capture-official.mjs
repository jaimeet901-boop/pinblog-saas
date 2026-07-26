/**
 * Visual QA capture for official template library.
 * Requires Vite on :3010 (npm run dev -- --port 3010).
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../../../docs/qa-evidence/official-templates');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

const consoleErrors = [];
page.on('console', (msg) => {
	if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

await page.goto('http://127.0.0.1:3010/qa-official.html', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__QA_READY__ && window.__QA_READY__.rendered >= 5, null, { timeout: 180000 });

const ready = await page.evaluate(() => window.__QA_READY__);
await page.locator('#gallery').screenshot({ path: path.join(outDir, 'gallery-full.png') });
await page.screenshot({ path: path.join(outDir, 'page-overview.png'), fullPage: true });
await page.locator('#pins').screenshot({ path: path.join(outDir, 'generated-pins-5.png') });

// Individual pin crops
const pinCount = await page.locator('#pins .pin img').count();
for (let i = 0; i < pinCount; i += 1) {
	await page.locator('#pins .pin').nth(i).screenshot({ path: path.join(outDir, `pin-${i + 1}.png`) });
}

const report = {
	ready,
	consoleErrors,
	outDir,
	files: fs.readdirSync(outDir),
};
fs.writeFileSync(path.join(outDir, 'qa-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
