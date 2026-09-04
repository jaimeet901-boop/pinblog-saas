/**
 * Rank, space, dedupe, and clamp image candidates into a final slot list.
 */

import { MAX_IMAGE_COUNT } from './constants.js';

function normalizeKey(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function tokenSet(value) {
	return new Set(normalizeKey(value).split(' ').filter((t) => t.length > 2));
}

/** Jaccard-like overlap — treat as duplicate if high shared tokens. */
export function conceptsTooSimilar(a, b) {
	const ka = normalizeKey(a);
	const kb = normalizeKey(b);
	if (!ka || !kb) return false;
	if (ka === kb) return true;
	const sa = tokenSet(ka);
	const sb = tokenSet(kb);
	if (sa.size === 0 || sb.size === 0) return false;
	let inter = 0;
	for (const t of sa) {
		if (sb.has(t)) inter += 1;
	}
	const union = sa.size + sb.size - inter;
	const score = union === 0 ? 0 : inter / union;
	return score >= 0.75;
}

/** Categories that must appear at most once in a plan (visual near-duplicates). */
export const EXCLUSIVE_VISUAL_CATEGORIES = new Set(['plated_finished']);

/**
 * Infer a coarse visual category for diversity (e.g. plated/finished vs process).
 */
export function inferVisualCategory(concept, query, explicit = null) {
	if (explicit) return String(explicit);
	const text = `${concept || ''} ${query || ''}`.toLowerCase();
	if (/\b(plated|plating|finished dish|serving presentation|plated serving|plated finished|served on a plate|final dish)\b/.test(text)) {
		return 'plated_finished';
	}
	return null;
}

/** True when two slots would show nearly the same visual kind. */
export function visualCategoriesOverlap(a, b) {
	const catA = inferVisualCategory(a?.concept, a?.query, a?.visualCategory);
	const catB = inferVisualCategory(b?.concept, b?.query, b?.visualCategory);
	if (catA && catB && catA === catB && EXCLUSIVE_VISUAL_CATEGORIES.has(catA)) return true;
	return false;
}

function isDuplicateAgainstUsed(cand, usedConcepts, usedQueries, usedVisual) {
	const concept = String(cand.concept || '').trim();
	const query = String(cand.query || '').trim();
	if (usedConcepts.some((c) => conceptsTooSimilar(c, concept))) return true;
	if (usedQueries.some((q) => conceptsTooSimilar(q, query))) return true;
	const cat = inferVisualCategory(concept, query, cand.visualCategory);
	if (cat && EXCLUSIVE_VISUAL_CATEGORIES.has(cat) && usedVisual.has(cat)) return true;
	return false;
}

function sortCandidates(candidates) {
	return [...candidates].sort((a, b) => {
		const ps = (Number(b.priorityScore) || 0) - (Number(a.priorityScore) || 0);
		if (ps !== 0) return ps;
		const ai = a.sectionIndex == null ? -1 : a.sectionIndex;
		const bi = b.sectionIndex == null ? -1 : b.sectionIndex;
		return ai - bi;
	});
}

/**
 * @param {Array<object>} enrichedCandidates
 * @param {{ imageCount: number }} options
 * @returns {Array<object>} selected slots (without final validation wrap)
 */
export function selectImageSlots(enrichedCandidates = [], { imageCount = 0 } = {}) {
	const requested = Math.max(0, Math.min(MAX_IMAGE_COUNT, Number(imageCount) || 0));
	if (requested <= 0) return [];

	const sorted = sortCandidates(enrichedCandidates);
	const selected = [];
	const usedConcepts = [];
	const usedQueries = [];
	const usedVisual = new Set();
	let featuredTaken = false;
	const usedSectionIndexes = [];

	const pushSlot = (cand) => {
		const concept = String(cand.concept || '').trim();
		const query = String(cand.query || '').trim();
		const priority = selected.length + 1;
		const cat = inferVisualCategory(concept, query, cand.visualCategory);
		const slot = {
			id: cand.type === 'featured' ? 'slot-featured' : `slot-${priority}-${cand.id}`,
			type: cand.type === 'featured' ? 'featured' : 'inline',
			priority,
			sectionIndex: cand.type === 'featured' ? null : (Number.isInteger(cand.sectionIndex) ? cand.sectionIndex : null),
			after: cand.after,
			concept,
			query,
			altHint: String(cand.altHint || concept).trim(),
			...(cat ? { visualCategory: cat } : {}),
		};
		selected.push(slot);
		usedConcepts.push(concept);
		usedQueries.push(query);
		if (cat && EXCLUSIVE_VISUAL_CATEGORIES.has(cat)) usedVisual.add(cat);
		if (slot.type === 'featured') featuredTaken = true;
		if (Number.isInteger(slot.sectionIndex)) usedSectionIndexes.push(slot.sectionIndex);
	};

	for (const cand of sorted) {
		if (selected.length >= requested) break;

		const concept = String(cand.concept || '').trim();
		const query = String(cand.query || '').trim();
		if (!concept || !query) continue;

		if (cand.type === 'featured') {
			if (featuredTaken) continue;
		}

		if (isDuplicateAgainstUsed(cand, usedConcepts, usedQueries, usedVisual)) continue;

		// Spacing: avoid adjacent section indexes when alternatives remain
		if (cand.type === 'inline' && Number.isInteger(cand.sectionIndex)) {
			const adjacent = usedSectionIndexes.some((idx) => Math.abs(idx - cand.sectionIndex) === 1);
			if (adjacent) {
				const remainingAfter = sorted.slice(sorted.indexOf(cand) + 1).filter((c) => {
					if (selected.length + 1 >= requested) return false;
					if (!c.concept || !c.query) return false;
					if (c.type === 'featured' && featuredTaken) return false;
					if (isDuplicateAgainstUsed(c, usedConcepts, usedQueries, usedVisual)) return false;
					if (Number.isInteger(c.sectionIndex)
						&& usedSectionIndexes.some((idx) => Math.abs(idx - c.sectionIndex) === 1)) {
						return false;
					}
					if (Number.isInteger(c.sectionIndex)
						&& usedSectionIndexes.includes(c.sectionIndex)) {
						return false;
					}
					return true;
				});
				const nonAdjacentPool = sorted.filter((c) => {
					if (c === cand) return false;
					if (selected.includes(c)) return false;
					if (!Number.isInteger(c.sectionIndex)) return c.type === 'featured' ? !featuredTaken : true;
					return !usedSectionIndexes.some((idx) => Math.abs(idx - c.sectionIndex) <= 1);
				}).filter((c) => {
					if (!c.concept || !c.query) return false;
					if (isDuplicateAgainstUsed(c, usedConcepts, usedQueries, usedVisual)) return false;
					return true;
				});
				if (nonAdjacentPool.length > 0 && selected.length + nonAdjacentPool.length >= requested - selected.length) {
					if (remainingAfter.length > 0 || nonAdjacentPool.length >= (requested - selected.length)) {
						continue;
					}
				}
				if (nonAdjacentPool.length >= (requested - selected.length)) {
					continue;
				}
			}
			if (usedSectionIndexes.includes(cand.sectionIndex)) continue;
		}

		pushSlot(cand);
	}

	// Second pass: if we skipped adjacent and came up short, fill ignoring spacing
	if (selected.length < requested) {
		for (const cand of sorted) {
			if (selected.length >= requested) break;
			const concept = String(cand.concept || '').trim();
			const query = String(cand.query || '').trim();
			if (!concept || !query) continue;
			if (cand.type === 'featured' && featuredTaken) continue;
			if (isDuplicateAgainstUsed(cand, usedConcepts, usedQueries, usedVisual)) continue;
			if (Number.isInteger(cand.sectionIndex) && usedSectionIndexes.includes(cand.sectionIndex)) continue;
			pushSlot(cand);
		}
	}

	return selected;
}
