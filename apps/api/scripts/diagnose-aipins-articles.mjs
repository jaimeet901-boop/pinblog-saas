/**
 * READ-ONLY production diagnostic: website → website_articles → AI Pins articles query.
 *
 * Resolves `pocketbase` from the API image layout (Dockerfile.api):
 *   WORKDIR /app/apps/api  →  dependencies hoisted under /app/node_modules
 *
 * Does not create, update, or delete any records.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';

function loadPocketBase() {
	// Match Dockerfile.api: npm ci --workspace apps/api from /app, WORKDIR /app/apps/api
	const packageJsonCandidates = [
		'/app/apps/api/package.json',
		'/app/package.json',
		path.join(process.cwd(), 'package.json'),
		path.join(process.cwd(), 'apps/api/package.json'),
	];

	const errors = [];
	for (const packageJsonPath of packageJsonCandidates) {
		if (!existsSync(packageJsonPath)) continue;
		try {
			const require = createRequire(packageJsonPath);
			const mod = require('pocketbase');
			return mod?.default || mod;
		} catch (error) {
			errors.push(`${packageJsonPath}: ${error?.message || error}`);
		}
	}

	throw new Error(
		`Cannot resolve package "pocketbase" from API image layout. Tried:\n${errors.join('\n') || '(no package.json candidates found)'}`,
	);
}

const PocketBase = loadPocketBase();

const domainArg = String(process.argv[2] || '')
	.trim()
	.toLowerCase()
	.replace(/^https?:\/\//, '')
	.replace(/^www\./, '')
	.split('/')[0];

if (!domainArg) {
	console.error('Usage: node diagnose-aipins-articles.mjs <domain>');
	process.exit(1);
}

const PB_BASE_URL = String(process.env.PB_BASE_URL || '').trim();
const PB_SUPERUSER_EMAIL = String(process.env.PB_SUPERUSER_EMAIL || '').trim();
const PB_SUPERUSER_PASSWORD = String(process.env.PB_SUPERUSER_PASSWORD || '').trim();

if (!PB_BASE_URL || !PB_SUPERUSER_EMAIL || !PB_SUPERUSER_PASSWORD) {
	console.error('Missing PB_BASE_URL / PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD in environment.');
	process.exit(1);
}

function normalizeDomain(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/^www\./, '')
		.split('/')[0];
}

function fieldNames(collection) {
	const fields = Array.isArray(collection?.fields)
		? collection.fields
		: (Array.isArray(collection?.schema) ? collection.schema : []);
	return new Set(fields.map((field) => field?.name).filter(Boolean));
}

async function resolveWebsiteField(pb) {
	const candidates = ['websiteId', 'website_id', 'website', 'siteId'];
	const collection = await pb.collections.getOne('website_articles');
	const names = fieldNames(collection);
	const websiteField = candidates.find((name) => names.has(name)) || 'websiteId';
	return { websiteField, statusField: names.has('status') ? 'status' : 'status' };
}

async function main() {
	const pb = new PocketBase(PB_BASE_URL);
	pb.autoCancellation(false);
	await pb.collection('_superusers').authWithPassword(PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD);

	const { websiteField } = await resolveWebsiteField(pb);

	const websites = await pb.collection('websites').getFullList({
		sort: '-created',
		requestKey: null,
	});

	const matched = websites.filter((site) => {
		const domain = normalizeDomain(site.domain || site.url || '');
		return domain === domainArg || domain.endsWith(`.${domainArg}`) || domainArg.endsWith(`.${domain}`);
	});

	console.log('=== DIAGNOSTIC REPORT (READ-ONLY) ===');
	console.log(JSON.stringify({
		domainArg,
		pbBaseUrl: PB_BASE_URL,
		websiteField,
		matchedWebsiteCount: matched.length,
		cwd: process.cwd(),
	}, null, 2));

	if (matched.length === 0) {
		console.log('\nNo websites matched this domain.');
		process.exit(0);
	}

	for (const site of matched) {
		console.log('\n--- WEBSITE ---');
		console.log(JSON.stringify({
			id: site.id,
			domain: site.domain || '',
			url: site.url || '',
			name: site.name || '',
			owner: site.owner || '',
			workspace: site.workspace || null,
			lifecycle_state: site.lifecycle_state || '',
			removed_at: site.removed_at || null,
			status: site.status || '',
			discovery_status: site.discovery_status || '',
		}, null, 2));

		// Exact same primary filter used by GET /ai-pins/articles → listWebsiteArticles
		// when no search/status/category query params are provided.
		const exactFilter = pb.filter(`${websiteField} = {:websiteId}`, { websiteId: site.id });

		const linked = await pb.collection('website_articles').getList(1, 5, {
			filter: exactFilter,
			sort: '-created',
			requestKey: null,
		});

		console.log('\n--- WEBSITE_ARTICLES LINKED TO THIS WEBSITE ---');
		console.log(JSON.stringify({
			totalArticles: linked.totalItems,
			first5ArticleIds: (linked.items || []).map((item) => item.id),
			first5: (linked.items || []).map((item) => ({
				id: item.id,
				websiteId: item.websiteId ?? item.website_id ?? item.website ?? null,
				owner: item.owner || '',
				status: item.status || '',
				title: String(item.title || '').slice(0, 80),
				url: item.url || '',
			})),
		}, null, 2));

		// Same call shape as AI Pins route (page=1, perPage=20, sort=-created, no filterExtra).
		const aiPinsLike = await pb.collection('website_articles').getList(1, 20, {
			filter: exactFilter,
			sort: '-created',
			requestKey: null,
		});

		console.log('\n--- GET /ai-pins/articles EQUIVALENT QUERY ---');
		console.log(JSON.stringify({
			exactFilter,
			page: 1,
			perPage: 20,
			sort: '-created',
			rawResultCountBeforeTransform: aiPinsLike.totalItems,
			rawPageItemCount: (aiPinsLike.items || []).length,
		}, null, 2));

		const linkedCount = Number(linked.totalItems) || 0;
		const aiPinsCount = Number(aiPinsLike.totalItems) || 0;
		const mismatch = linkedCount !== aiPinsCount;

		console.log('\n--- COMPARISON ---');
		console.log(JSON.stringify({
			websiteId: site.id,
			linkedArticlesCount: linkedCount,
			aiPinsEquivalentRawCount: aiPinsCount,
			mismatch,
			verdict: linkedCount === 0
				? 'NO ARTICLES LINKED TO THIS WEBSITE ID (break is before AI Pins list, or wrong website id)'
				: mismatch
					? 'MISMATCH between linked count and AI Pins equivalent query'
					: 'COUNTS MATCH — articles exist and the AI Pins primary query would return them for this websiteId',
		}, null, 2));
	}

	console.log('\n=== END DIAGNOSTIC REPORT ===');
}

main().catch((error) => {
	console.error('Diagnostic failed:', error?.message || error);
	process.exit(1);
});
