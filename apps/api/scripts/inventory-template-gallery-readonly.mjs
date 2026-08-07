/**
 * Read-only template gallery inventory — NO writes.
 * Usage (production):
 *   docker compose -f docker-compose.prod.yml exec api node scripts/inventory-template-gallery-readonly.mjs
 * Usage (local):
 *   node --env-file=.env scripts/inventory-template-gallery-readonly.mjs
 */
import PocketBase from 'pocketbase';
import { validateTemplateConfiguration } from '../src/utils/template-config-validation.js';
import { extractRecordChannel } from '../src/constants/template-channels.js';

const pb = new PocketBase(process.env.PB_BASE_URL || 'http://127.0.0.1:8090');
const email = process.env.PB_SUPERUSER_EMAIL;
const password = process.env.PB_SUPERUSER_PASSWORD;

if (!email || !password) {
	console.error('Missing PB_SUPERUSER_EMAIL or PB_SUPERUSER_PASSWORD');
	process.exit(1);
}

await pb.admins.authWithPassword(email, password);

const platformUser = await pb.collection('users').getList(1, 1, {
	sort: 'created',
	fields: 'id,email',
});
const platformOwnerId = platformUser.items?.[0]?.id || '';

const rows = await pb.collection('ai_pin_templates').getFullList({
	filter: 'deleted_at = "" && (status = "" || status != "archived")',
	sort: '-created',
});

let previewCacheIds = new Set();
try {
	const cacheRows = await pb.collection('ai_pin_template_preview_cache').getFullList({
		filter: 'deleted_at = ""',
		fields: 'template_id,config_checksum,image_url',
	});
	previewCacheIds = new Set(cacheRows.filter((r) => r.image_url).map((r) => r.template_id));
} catch {
	// optional collection
}

function fingerprint(record) {
	const c = record.configuration || {};
	const L = c.layout || {};
	const T = c.typography || {};
	return [
		L.variantId || 'no-variant',
		c.canvas?.width,
		c.canvas?.height,
		T.fontFamily,
		T.fontSize || T.titleSize,
	].join('|');
}

function isOfficial(record) {
	const meta = record.marketplace_meta && typeof record.marketplace_meta === 'object'
		? record.marketplace_meta
		: {};
	const uuid = String(record.template_uuid || '');
	return record.visibility === 'official'
		|| meta.official === true
		|| uuid.startsWith('chefia-official-');
}

function isLegacy(record) {
	const meta = record.marketplace_meta && typeof record.marketplace_meta === 'object'
		? record.marketplace_meta
		: {};
	return !meta.channel && !meta.pack && !meta.official;
}

function classifyTier(record) {
	const validation = validateTemplateConfiguration(record.configuration);
	if (!validation.ok) return 'C';

	const cfg = record.configuration || {};
	const hasLayers = Array.isArray(cfg.layers) && cfg.layers.length > 0;
	const hasLayout = Boolean(cfg.layout?.variantId);
	const hasCanvas = Number(cfg.canvas?.width) > 0 && Number(cfg.canvas?.height) > 0;
	const name = String(record.name || '').trim();

	if (!hasCanvas && !hasLayers && !hasLayout) return 'C';
	if (/^untitled/i.test(name) || /^test\b/i.test(name) || name === '') return 'D';

	const status = String(record.status || '').trim();
	const isDraft = status === 'draft';
	const isPremium = Boolean(record.marketplace_meta?.premium || record.marketplace_meta?.access?.requires?.length);

	if (validation.ok && (hasLayers || hasLayout) && hasCanvas) {
		if (isDraft || isPremium) return 'B';
		return 'A';
	}
	return 'C';
}

function classifySource(record) {
	if (isOfficial(record)) return 'official';
	if (platformOwnerId && record.owner === platformOwnerId) return 'platform_owner';
	if (record.workspace_id || record.workspace) return 'workspace';
	return 'user';
}

function hasPreview(record) {
	if (record.thumbnail) return true;
	return previewCacheIds.has(record.id);
}

const byChannel = { pinterest: [], facebook: [], other: [] };
for (const row of rows) {
	const ch = extractRecordChannel(row);
	if (ch === 'facebook') byChannel.facebook.push(row);
	else if (ch === 'pinterest') byChannel.pinterest.push(row);
	else byChannel.other.push(row);
}

function analyze(list) {
	const checksumGroups = {};
	const uuidGroups = {};
	const fpGroups = {};

	for (const r of list) {
		const sum = String(r.config_checksum || 'none').toLowerCase();
		checksumGroups[sum] = (checksumGroups[sum] || 0) + 1;
		const uuid = String(r.template_uuid || 'none');
		uuidGroups[uuid] = (uuidGroups[uuid] || 0) + 1;
		const fp = fingerprint(r);
		fpGroups[fp] = (fpGroups[fp] || 0) + 1;
	}

	const duplicateChecksumGroups = Object.values(checksumGroups).filter((n) => n > 1).length;
	const maxDuplicateCount = Math.max(0, ...Object.values(checksumGroups));

	const tiers = { A: 0, B: 0, C: 0, D: 0 };
	const sources = { official: 0, platform_owner: 0, user: 0, workspace: 0 };
	let legacy = 0;
	let withLayers = 0;
	let procedural = 0;
	let withPreview = 0;
	let untitled = 0;

	for (const r of list) {
		tiers[classifyTier(r)]++;
		sources[classifySource(r)]++;
		if (isLegacy(r)) legacy++;
		if (Array.isArray(r.configuration?.layers) && r.configuration.layers.length > 0) withLayers++;
		if (r.configuration?.layout?.variantId && !(r.configuration?.layers?.length)) procedural++;
		if (hasPreview(r)) withPreview++;
		if (/^untitled/i.test(String(r.name || ''))) untitled++;
	}

	return {
		count: list.length,
		tiers,
		sources,
		legacy,
		withLayers,
		procedural,
		withPreview,
		untitled,
		uniqueUuid: new Set(list.map((r) => r.template_uuid).filter(Boolean)).size,
		uniqueChecksum: new Set(list.map((r) => r.config_checksum).filter(Boolean)).size,
		uniqueFingerprint: new Set(list.map(fingerprint)).size,
		duplicateChecksumGroups,
		maxDuplicateCount,
		topDuplicateChecksums: Object.entries(checksumGroups)
			.filter(([, n]) => n > 1)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([checksum, count]) => ({ checksum: checksum.slice(0, 16), count })),
	};
}

const report = {
	generatedAt: new Date().toISOString(),
	platformOwnerId,
	totalRows: rows.length,
	pinterest: analyze(byChannel.pinterest),
	facebook: analyze(byChannel.facebook),
	otherChannels: analyze(byChannel.other),
	recommendations: null,
};

const p = report.pinterest;
report.recommendations = {
	galleryKeep: p.tiers.A + p.tiers.B,
	galleryHideOnly: p.tiers.D,
	galleryArchive: p.tiers.C,
	devLegacyData: p.legacy,
	note: 'Keep = Tier A+B unique designs worth showing; Hide = junk/test; Archive = broken/invalid; Dev legacy = no marketplace_meta.channel',
};

console.log(JSON.stringify(report, null, 2));
