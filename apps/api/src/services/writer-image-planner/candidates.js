/**
 * Deterministic image-slot candidates from article structure.
 * FAQ and conclusion are never candidates.
 */

import { AFTER_HERO, AFTER_INTRODUCTION, afterSection } from './constants.js';

function stripHtml(value) {
	return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isFaqLikeHeading(heading) {
	return /\bfaq\b|frequently asked|common questions/i.test(String(heading || ''));
}

function isConclusionLikeHeading(heading) {
	return /\bconclusion\b|\bfinal thoughts\b|\bwrap[- ]?up\b|\bin summary\b/i.test(String(heading || ''));
}

function isLowVisualHeading(heading) {
	const h = String(heading || '').toLowerCase();
	if (!h) return true;
	if (isFaqLikeHeading(h) || isConclusionLikeHeading(h)) return true;
	if (/^(introduction|intro|overview|about this|why you.?ll love|why this)\b/i.test(h)) {
		return true;
	}
	return false;
}

/** Soft low-value: still candidates, but strongly down-ranked. */
function isLowValueProcessHeading(heading) {
	const h = String(heading || '').toLowerCase().trim();
	return /^(what you need|what you.?ll need|materials|supplies|tools and materials|overview|tips|tip|common mistakes|mistakes to avoid|notes|disclaimer|before you (start|begin)|getting started)\b/i.test(h)
		|| /\b(common mistakes|tips? only)\b/i.test(h);
}

const PROCESS_VERBS = /\b(cook(?:ing)?|fry(?:ing)?|sear(?:ing)?|bake|baking|roast(?:ing)?|grill(?:ing)?|simmer(?:ing)?|saute|sauté|mix(?:ing)?|whisk(?:ing)?|chop(?:ping)?|dic(?:e|ing)|slic(?:e|ing)|prep(?:ar(?:e|ing))?|clean(?:ing)?|remov(?:e|ing)|season(?:ing)?|assembl(?:e|ing)|combin(?:e|ing)|stir(?:ring)?|toss(?:ing)?|knead(?:ing)?|layer(?:ing)?|minc(?:e|ing)|scrub(?:bing)?|dry(?:ing)?|wash(?:ing)?)\b/i;

/**
 * Prefer concrete process / visual section headings for recipes & how-tos.
 * Serving/plated is down-ranked — featured usually covers the finished dish.
 */
function sectionPriorityBoost(heading, articleType) {
	const h = String(heading || '').toLowerCase();
	let score = 50;

	if (isLowValueProcessHeading(h)) {
		score -= 40;
	}

	if (articleType === 'recipe' || articleType === 'how-to') {
		if (PROCESS_VERBS.test(h)) score += 36;
		// Sauce boost only for sauce-focused steps (not "combine … and sauce")
		if (/\b(sauce|gravy|dressing|marinade)\b/i.test(h)
			&& !/\b(combin(?:e|ing)|toss(?:ing)?|mix(?:ing)?|assembl(?:e|ing))\b/i.test(h)) {
			score += 30;
		}
		if (/\b(ingredient)\b/i.test(h)) score += 12;
		// Finished presentation — featured already covers plated/finished; keep as last resort
		if (/\b(serv(?:e|ing)|plat(?:e|ing)|garnish|finish(?:ed)?\s+dish|final\s+dish)\b/i.test(h)) {
			score -= 28;
		}
		if (/\b(step\s*\d|instructions?|method)\b/i.test(h)) score += 20;
		// Featured stays highest priority (100); never outrank it
		if (score >= 100) score = 99;
	}
	if (articleType === 'listicle') {
		if (/^\d+|top |best /i.test(h)) score += 25;
	}
	if (articleType === 'comparison') {
		if (/\bvs\.?|versus|compared?\b/i.test(h)) score += 25;
	}
	if (articleType === 'review') {
		if (/\b(design|taste|performance|features?|unboxing)\b/i.test(h)) score += 20;
	}
	if (/\b(faq|conclusion|summary)\b/i.test(h)) score -= 40;
	return score;
}

/**
 * @param {object} article
 * @param {string} articleType
 * @returns {Array<object>} raw candidates (not yet capped/validated as final plan)
 */
export function buildImageCandidates(article = {}, articleType = 'informational') {
	const title = String(article?.seo_title || '').trim() || 'article subject';
	const sections = Array.isArray(article?.sections) ? article.sections : [];
	const candidates = [];

	candidates.push({
		id: 'cand-featured',
		type: 'featured',
		priorityScore: 100,
		sectionIndex: null,
		after: AFTER_HERO,
		heading: title,
		kind: 'featured',
		snippet: stripHtml(article?.introduction).slice(0, 160),
	});

	sections.forEach((section, index) => {
		const heading = String(section?.heading || '').trim();
		if (!heading) return;
		if (isFaqLikeHeading(heading)) return;
		if (isConclusionLikeHeading(heading)) return;
		if (isLowVisualHeading(heading)) return;

		const boost = sectionPriorityBoost(heading, articleType);
		if (boost < 30 && articleType === 'informational') {
			if (!/\b[a-z]{4,}\b/i.test(heading)) return;
		}

		candidates.push({
			id: `cand-section-${index}`,
			type: 'inline',
			priorityScore: boost,
			sectionIndex: index,
			after: afterSection(index),
			heading,
			kind: 'section',
			snippet: stripHtml(section?.content).slice(0, 160),
		});
	});

	// If we have almost no section candidates, allow after-introduction as a soft alternate
	const inlineCount = candidates.filter((c) => c.type === 'inline').length;
	if (inlineCount === 0 && stripHtml(article?.introduction).length > 40) {
		candidates.push({
			id: 'cand-after-intro',
			type: 'inline',
			priorityScore: 40,
			sectionIndex: null,
			after: AFTER_INTRODUCTION,
			heading: title,
			kind: 'intro',
			snippet: stripHtml(article?.introduction).slice(0, 160),
		});
	}

	return candidates;
}

export {
	isFaqLikeHeading,
	isConclusionLikeHeading,
	isLowVisualHeading,
	isLowValueProcessHeading,
	PROCESS_VERBS,
};
