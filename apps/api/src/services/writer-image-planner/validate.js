/**
 * Validate and safely normalize an image plan.
 * Never throws to callers — returns { ok, plan, errors }.
 */

import { MAX_IMAGE_COUNT, SLOT_TYPES } from './constants.js';
import { isKnownArticleType } from './detect-article-type.js';
import { conceptsTooSimilar, visualCategoriesOverlap } from './select.js';
import { isFaqLikeHeading, isConclusionLikeHeading } from './candidates.js';

function emptyPlan(requestedCount = 0, articleType = 'informational') {
	return {
		requestedCount: Math.max(0, Number(requestedCount) || 0),
		plannedCount: 0,
		articleType,
		imageSlots: [],
	};
}

/**
 * @param {unknown} plan
 * @param {{ article?: object, allowConclusion?: boolean }} [options]
 */
export function validateImagePlan(plan, { article = null, allowConclusion = false } = {}) {
	const errors = [];
	if (!plan || typeof plan !== 'object') {
		return { ok: false, plan: emptyPlan(0), errors: ['plan must be an object'] };
	}

	let requestedCount = Number(plan.requestedCount);
	if (!Number.isFinite(requestedCount) || requestedCount < 0) {
		errors.push('invalid requestedCount');
		requestedCount = 0;
	}
	requestedCount = Math.min(MAX_IMAGE_COUNT, Math.max(0, Math.floor(requestedCount)));

	let articleType = String(plan.articleType || 'informational').toLowerCase();
	if (!isKnownArticleType(articleType)) {
		errors.push('invalid articleType');
		articleType = 'informational';
	}

	const rawSlots = Array.isArray(plan.imageSlots) ? plan.imageSlots : [];
	const sections = Array.isArray(article?.sections) ? article.sections : [];
	const seenIds = new Set();
	const concepts = [];
	const queries = [];
	const acceptedSlots = [];
	let featuredCount = 0;
	const normalized = [];

	for (const slot of rawSlots) {
		if (!slot || typeof slot !== 'object') {
			errors.push('invalid slot');
			continue;
		}

		const id = String(slot.id || '').trim();
		if (!id) {
			errors.push('slot missing id');
			continue;
		}
		if (seenIds.has(id)) {
			errors.push(`duplicate slot id ${id}`);
			continue;
		}

		const type = String(slot.type || '').trim();
		if (!SLOT_TYPES.includes(type)) {
			errors.push(`invalid slot type ${type}`);
			continue;
		}
		if (type === 'featured') {
			featuredCount += 1;
			if (featuredCount > 1) {
				errors.push('more than one featured slot');
				continue;
			}
		}

		let sectionIndex = slot.sectionIndex;
		if (sectionIndex != null) {
			sectionIndex = Number(sectionIndex);
			if (!Number.isInteger(sectionIndex) || sectionIndex < 0) {
				errors.push('invalid sectionIndex');
				continue;
			}
			if (sections.length && sectionIndex >= sections.length) {
				errors.push('sectionIndex out of range');
				continue;
			}
			const heading = sections[sectionIndex]?.heading;
			if (isFaqLikeHeading(heading)) {
				errors.push('FAQ section targeted');
				continue;
			}
			if (!allowConclusion && isConclusionLikeHeading(heading)) {
				errors.push('conclusion section targeted');
				continue;
			}
		} else {
			sectionIndex = null;
		}

		const concept = String(slot.concept || '').trim();
		const query = String(slot.query || '').trim();
		if (!concept || !query) {
			errors.push('slot missing concept or query');
			continue;
		}
		if (concepts.some((c) => conceptsTooSimilar(c, concept))) {
			errors.push('duplicate concept');
			continue;
		}
		if (queries.some((q) => conceptsTooSimilar(q, query))) {
			errors.push('duplicate query');
			continue;
		}
		const candidateSlot = { concept, query, visualCategory: slot.visualCategory };
		if (acceptedSlots.some((prev) => visualCategoriesOverlap(prev, candidateSlot))) {
			errors.push('duplicate visual category');
			continue;
		}

		const after = String(slot.after || '').trim() || (type === 'featured' ? 'hero' : 'introduction');
		seenIds.add(id);
		concepts.push(concept);
		queries.push(query);
		acceptedSlots.push(candidateSlot);
		normalized.push({
			id,
			type,
			priority: Number(slot.priority) || normalized.length + 1,
			sectionIndex,
			after,
			concept,
			query,
			altHint: String(slot.altHint || concept).trim(),
			...(slot.visualCategory ? { visualCategory: String(slot.visualCategory) } : {}),
		});
	}

	const clipped = normalized.slice(0, requestedCount).map((slot, index) => ({
		...slot,
		priority: index + 1,
	}));

	const safePlan = {
		requestedCount,
		plannedCount: clipped.length,
		articleType,
		imageSlots: clipped,
	};

	return {
		ok: errors.length === 0,
		plan: safePlan,
		errors,
	};
}

/**
 * Ensure final plan invariants; drop bad slots rather than throwing.
 */
export function normalizeImagePlan(plan, options = {}) {
	const result = validateImagePlan(plan, options);
	return result.plan;
}
