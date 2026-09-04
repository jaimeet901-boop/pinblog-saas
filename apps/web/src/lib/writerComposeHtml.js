/**
 * Writer article HTML composition (M3-B1).
 * Pure / synchronous — no network, providers, credits, or DB.
 *
 * Legacy path preserves pre-M3-B1 composeHtml byte-for-byte when there are
 * no placeable inline images.
 */

/**
 * M3-B0 heading fingerprint contract (trim → collapse whitespace → lowercase).
 * @param {unknown} heading
 * @returns {string|null}
 */
export function normalizeHeadingFingerprint(heading) {
	const normalized = String(heading ?? '')
		.trim()
		.replace(/\s+/g, ' ')
		.toLowerCase();
	return normalized || null;
}

/**
 * Escape dynamic values for HTML attribute insertion.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtmlAttr(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

const ALLOWED_DATA_IMAGE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i;

/**
 * Validate image URL for body insertion (no network).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAllowedComposerImageUrl(value) {
	const raw = String(value ?? '').trim();
	if (!raw) return false;
	if (raw.startsWith('//')) return false;
	if (ALLOWED_DATA_IMAGE.test(raw)) return true;
	try {
		const parsed = new URL(raw);
		return parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * Exact pre-M3-B1 Writer composeHtml behavior.
 * @param {object} a
 * @returns {string}
 */
export function composeLegacyArticleHtml(a) {
	const parts = [];
	if (a.introduction) parts.push(a.introduction);
	for (const s of a.sections || []) {
		const level = s.level === 'h3' ? 'h3' : 'h2';
		parts.push(`<${level}>${s.heading || ''}</${level}>`);
		parts.push(s.content || '');
	}
	if (a.faq?.length) {
		parts.push('<h2>Frequently Asked Questions</h2>');
		for (const f of a.faq) {
			parts.push(`<h3>${f.question || ''}</h3>`);
			parts.push(`<p>${f.answer || ''}</p>`);
		}
	}
	if (a.conclusion) {
		parts.push('<h2>Conclusion</h2>');
		parts.push(a.conclusion);
	}
	if (a.recipe_schema) {
		parts.push(
			`<script type="application/ld+json">${JSON.stringify(a.recipe_schema)}</script>`,
		);
	}
	return parts.join('\n');
}

/**
 * @param {object} asset
 * @returns {string}
 */
function buildInlineFigureHtml(asset) {
	const src = escapeHtmlAttr(String(asset.url || '').trim());
	const alt = escapeHtmlAttr(asset.alt == null ? '' : String(asset.alt));
	const width = Number(asset.width);
	const height = Number(asset.height);
	const widthAttr = Number.isInteger(width) && width > 0 ? ` width="${width}"` : '';
	const heightAttr = Number.isInteger(height) && height > 0 ? ` height="${height}"` : '';
	return [
		'<figure class="seodeva-article-image">',
		`  <img src="${src}" alt="${alt}" loading="lazy"${widthAttr}${heightAttr} />`,
		'</figure>',
	].join('\n');
}

/**
 * Select at most one placeable inline asset per section (first-wins).
 * Dedupes slotId and URL in assets array order. Featured / intro / stale → skipped.
 *
 * @param {object} article
 * @returns {Map<number, object>}
 */
export function selectPlaceableInlineAssetsBySection(article) {
	const bySection = new Map();
	const assets = Array.isArray(article?.images?.assets) ? article.images.assets : [];
	const sections = Array.isArray(article?.sections) ? article.sections : [];
	if (!assets.length || !sections.length) return bySection;

	const seenSlotIds = new Set();
	const seenUrls = new Set();
	const usedSections = new Set();

	for (const asset of assets) {
		if (!asset || typeof asset !== 'object' || Array.isArray(asset)) continue;
		if (asset.status !== 'resolved') continue;
		if (asset.type !== 'inline') continue;

		const url = String(asset.url || '').trim();
		if (!url || !isAllowedComposerImageUrl(url)) continue;

		const sectionIndex = Number(asset.sectionIndex);
		if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || sectionIndex >= sections.length) {
			continue;
		}

		const fingerprint = String(asset.headingFingerprint || '').trim();
		if (!fingerprint) continue;

		const currentFp = normalizeHeadingFingerprint(sections[sectionIndex]?.heading);
		if (!currentFp || currentFp !== fingerprint) continue;

		const slotId = String(asset.slotId || '').trim();
		if (slotId && seenSlotIds.has(slotId)) continue;
		if (seenUrls.has(url)) continue;
		if (usedSections.has(sectionIndex)) continue;

		if (slotId) seenSlotIds.add(slotId);
		seenUrls.add(url);
		usedSections.add(sectionIndex);
		bySection.set(sectionIndex, asset);
	}

	return bySection;
}

/**
 * Compose Writer article HTML. Uses legacy composer when no placeable inlines.
 * @param {object} article
 * @returns {string}
 */
export function composeArticleHtml(article) {
	const a = article && typeof article === 'object' ? article : {};
	const bySection = selectPlaceableInlineAssetsBySection(a);
	if (bySection.size === 0) {
		return composeLegacyArticleHtml(a);
	}

	const parts = [];
	if (a.introduction) parts.push(a.introduction);
	for (let index = 0; index < (a.sections || []).length; index += 1) {
		const s = a.sections[index];
		const level = s?.level === 'h3' ? 'h3' : 'h2';
		parts.push(`<${level}>${s?.heading || ''}</${level}>`);
		parts.push(s?.content || '');
		const asset = bySection.get(index);
		if (asset) {
			parts.push(buildInlineFigureHtml(asset));
		}
	}
	if (a.faq?.length) {
		parts.push('<h2>Frequently Asked Questions</h2>');
		for (const f of a.faq) {
			parts.push(`<h3>${f.question || ''}</h3>`);
			parts.push(`<p>${f.answer || ''}</p>`);
		}
	}
	if (a.conclusion) {
		parts.push('<h2>Conclusion</h2>');
		parts.push(a.conclusion);
	}
	if (a.recipe_schema) {
		parts.push(
			`<script type="application/ld+json">${JSON.stringify(a.recipe_schema)}</script>`,
		);
	}
	return parts.join('\n');
}
