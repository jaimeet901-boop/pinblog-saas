/**
 * Phase 1 workspace isolation regression checks (static + unit).
 * Run: node apps/api/src/routes/workspace-isolation-phase1.regression.test.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const results = [];

function check(name, pass, detail = '') {
	results.push({ name, pass: Boolean(pass), detail });
	console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
}

function read(rel) {
	return readFileSync(path.join(root, rel), 'utf8');
}

// 1. Orphan claim removed
{
	const src = read('apps/api/src/routes/ai-pins.js');
	const hasClaim = /update\(\s*site\.id\s*,\s*\{\s*owner:\s*userId/.test(src)
		|| /Cannot be claimed/.test(src) === false && /storedOwnerId === userId/.test(src) && /!storedOwnerId && userId/.test(src);
	const deniesOrphan = src.includes('cannot be claimed') || src.includes('has no owner');
	const noClaimUpdate = !/update\(\s*site\.id\s*,\s*\{\s*owner:\s*userId/.test(src);
	check('C1 orphan website claim removed', deniesOrphan && noClaimUpdate);
}

// 2. No frontend tenant PB CRUD
{
	const tenantCollections = ['ai_pins', 'websites', 'articles', 'pins', 'website_articles', 'brand_kits'];
	const webSrcFiles = [
		'apps/web/src/pages/app/AIPinsPage.jsx',
		'apps/web/src/pages/app/WriterPage.jsx',
		'apps/web/src/pages/app/ImagesPage.jsx',
		'apps/web/src/pages/app/SettingsPage.jsx',
		'apps/web/src/services/ai-pins/draftService.js',
	];
	let leaked = [];
	for (const file of webSrcFiles) {
		const src = read(file);
		for (const col of tenantCollections) {
			const re = new RegExp(`pb\\.collection\\(['"]${col}['"]\\)`);
			if (re.test(src)) leaked.push(`${file} → ${col}`);
		}
	}
	check('C2 no frontend tenant pb.collection CRUD', leaked.length === 0, leaked.join('; ') || 'clean');
}

// 3. API endpoints exist
{
	const aiPins = read('apps/api/src/routes/ai-pins.js');
	const content = read('apps/api/src/routes/tenant-content.js');
	const index = read('apps/api/src/routes/index.js');
	check('API GET /ai-pins/pins', /router\.get\(\s*'\/pins'/.test(aiPins));
	check('API DELETE /ai-pins/pins/:pinId', /router\.delete\(\s*'\/pins\/:pinId'/.test(aiPins));
	check('API PATCH /ai-pins/pins/:pinId', /router\.patch\(\s*'\/pins\/:pinId'/.test(aiPins));
	check('API content articles/pins', /router\.get\(\s*'\/articles'/.test(content) && /router\.post\(\s*'\/pins'/.test(content));
	check('content router mounted', /tenant-content|\/content'/.test(index) && index.includes("'/content'"));
}

// 4. Editor accepts pinterest fields (no second PB write needed)
{
	const aiPins = read('apps/api/src/routes/ai-pins.js');
	check('Editor accepts pinterestAccountId', aiPins.includes('pinterestAccountId'));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n=== Phase 1 Summary: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
	console.log('Failed:', failed.map((f) => f.name).join(', '));
	process.exit(1);
}
console.log('Safe to continue to Phase 2 after human review: YES (Phase 1 critical gate)');
process.exit(0);
