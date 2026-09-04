/**
 * Build distinct visual concepts and stock-search queries from candidates.
 * Deterministic M1.1 — no external AI/provider calls.
 */

import { isLowValueProcessHeading } from './candidates.js';

function cleanPhrase(value) {
	return String(value || '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/[^\w\s'-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Strip common list numbering: "1. Foo", "2) Foo", "3 - Foo", "#4 Foo"
 */
export function stripListNumbering(value) {
	return cleanPhrase(value)
		.replace(/^#?\d+\s*[).:\-–—]\s*/u, '')
		.replace(/^(?:step\s*)?\d+\s*[).:\-–—]?\s+/iu, '')
		.replace(/^#\d+\s+/u, '')
		.trim();
}

/**
 * Visual subject from SEO title — strip marketing fluff / list counts for stock/Fal queries.
 */
export function visualSubject(article) {
	let t = cleanPhrase(article?.seo_title || '');
	if (!t) return 'subject';

	t = t.replace(/^how\s+to\s+/i, '');
	t = t.replace(/^\d+\s+/u, '');
	t = t.replace(/^(top|best)\s+\d+\s+/i, '');

	// Marketing fluff only — keep descriptive topic words like "healthy"
	const fluffPrefix = /^(easy|best|top|simple|quick|ultimate|delicious|homemade|perfect)\s+/i;
	for (let i = 0; i < 4 && fluffPrefix.test(t); i += 1) {
		t = t.replace(fluffPrefix, '');
	}

	t = t.replace(/\s+(recipe|guide|tutorial|tips|ideas|ways|steps|for beginners)$/i, '');
	t = t.replace(/\s+/g, ' ').trim();

	// "Clean a Cast Iron Pan" → prefer the object noun phrase for stock search
	const imperativeObject = t.match(/^(clean|fix|install|build|make|prepare|set up)\s+(?:a|an|the)\s+(.+)$/i);
	if (imperativeObject) {
		t = imperativeObject[2].trim();
	}

	return t || cleanPhrase(article?.seo_title) || 'subject';
}

function titleSubject(article) {
	return visualSubject(article);
}

function platedServingConcept(subject) {
	return {
		concept: 'plated serving presentation',
		query: `${subject} plated serving`,
		altHint: `Plated ${subject}`,
		visualCategory: 'plated_finished',
	};
}

/**
 * Recipe process focus from heading — prefer action imagery over title clones.
 */
function recipeConceptFromHeading(heading, subject) {
	const h = stripListNumbering(heading).toLowerCase();
	const focus = stripListNumbering(heading);
	const subj = subject.toLowerCase();

	// Combine / assemble before sauce — "Combining pasta … and sauce" is not a sauce step
	if (/\b(combin|toss|mix).*pasta|pasta.*(sauce|chicken)|assembl/i.test(h)
		|| (/\b(combin|toss|mix|assembl)\b/i.test(h) && /\b(pasta|chicken|sauce|ingredient)\b/i.test(h))) {
		return {
			concept: 'combining pasta with sauce',
			query: 'pasta being tossed with creamy sauce in skillet',
			altHint: 'Pasta combined with creamy sauce in a skillet',
			visualCategory: 'process_combine',
		};
	}

	if (/\b(combin|toss|mix|assembl)\b/i.test(h)) {
		return {
			concept: focus.toLowerCase(),
			query: `${subj} ${focus.toLowerCase()} mixing bowl`,
			altHint: focus,
			visualCategory: 'process_combine',
		};
	}

	if (/\bcook(?:ing)?\b/i.test(h)) {
		const protein = h.match(/\b(chicken|beef|pork|shrimp|tofu|fish|salmon|turkey|lamb)\b/i)?.[0]?.toLowerCase();
		if (protein) {
			return {
				concept: `cooking ${protein}`,
				query: `${protein} cooking in skillet pan`,
				altHint: `${protein[0].toUpperCase()}${protein.slice(1)} cooking in a skillet`,
				visualCategory: 'process_cook',
			};
		}
		return {
			concept: focus.toLowerCase(),
			query: `${focus} cooking process`,
			altHint: focus,
			visualCategory: 'process_cook',
		};
	}

	if (/\bsauce\b|alfredo/i.test(h)) {
		const named = h.match(/\b([a-z]+)\s+sauce\b/i)?.[1]?.toLowerCase();
		const stop = new Set(['the', 'a', 'an', 'and', 'with', 'or', 'for', 'our']);
		if (named && !stop.has(named)) {
			return {
				concept: `${named} sauce preparation`,
				query: `${named} sauce being stirred in pan`,
				altHint: `${named[0].toUpperCase()}${named.slice(1)} sauce simmering in a pan`,
				visualCategory: 'process_sauce',
			};
		}
		if (/alfredo/i.test(h)) {
			return {
				concept: 'alfredo sauce preparation',
				query: 'creamy alfredo sauce being stirred in pan',
				altHint: 'Creamy Alfredo sauce simmering in a pan',
				visualCategory: 'process_sauce',
			};
		}
		return {
			concept: `${focus.toLowerCase()} preparation`,
			query: `${focus} stirred in cooking pan`,
			altHint: `${focus} in a cooking pan`,
			visualCategory: 'process_sauce',
		};
	}

	if (/\bserv(?:e|ing)|plat(?:e|ing)|garnish|finish(?:ed)?\b/i.test(h)) {
		return platedServingConcept(subj);
	}

	if (/\bingredient/i.test(h)) {
		return {
			concept: 'recipe ingredients flat lay',
			query: `${subj} ingredients flat lay`,
			altHint: `Ingredients for ${subject}`,
			visualCategory: 'ingredients',
		};
	}

	if (/\b(bake|baking|oven)\b/i.test(h)) {
		return {
			concept: 'baking in oven',
			query: `${subj} baking in oven`,
			altHint: focus,
			visualCategory: 'process_bake',
		};
	}

	if (/\b(prep|chop|dice|slice|mince)\b/i.test(h)) {
		return {
			concept: 'food preparation chopping',
			query: `${subj} food preparation chopping`,
			altHint: focus,
			visualCategory: 'process_prep',
		};
	}

	return {
		concept: focus.toLowerCase(),
		query: `${subj} ${focus.toLowerCase()} cooking process`,
		altHint: focus,
		visualCategory: 'process_generic',
	};
}

/**
 * How-to: topic + section intent — never bare abstract headings alone.
 */
function howtoConceptFromHeading(heading, subject) {
	const h = stripListNumbering(heading).toLowerCase();
	const focus = stripListNumbering(heading);
	const subj = subject.toLowerCase();

	if (isLowValueProcessHeading(heading) || /^(what you need|materials|supplies|tools)\b/i.test(h)) {
		return {
			concept: `${subj} tools and materials`,
			query: `${subj} tools supplies flat lay`,
			altHint: `Tools and materials for ${subject}`,
			visualCategory: 'materials',
		};
	}

	if (/\b(remov|residue|scrap|debris)\b/i.test(h)) {
		return {
			concept: `removing residue from ${subj}`,
			query: `${subj} food residue being scraped cleaned`,
			altHint: `Removing residue from ${subject}`,
			visualCategory: 'process_remove',
		};
	}

	if (/\b(clean|cleaning|wash|scrub|rinse)\b/i.test(h)) {
		return {
			concept: `cleaning ${subj}`,
			query: `${subj} being cleaned scrubbing`,
			altHint: `Cleaning ${subject}`,
			visualCategory: 'process_clean',
		};
	}

	if (/\b(dry(?:ing)?|season(?:ing)?)\b/i.test(h)) {
		return {
			concept: `drying and seasoning ${subj}`,
			query: `${subj} oil seasoning with cloth`,
			altHint: `Drying and seasoning ${subject}`,
			visualCategory: 'process_season',
		};
	}

	if (/\b(install|assembl|attach|mount)\b/i.test(h)) {
		return {
			concept: focus.toLowerCase(),
			query: `${subj} ${focus.toLowerCase()} hands working`,
			altHint: focus,
			visualCategory: 'process_assemble',
		};
	}

	if (/\b(common mistakes|mistakes|tips)\b/i.test(h)) {
		return {
			concept: `${subj} common mistake example`,
			query: `${subj} damaged worn incorrect use`,
			altHint: focus,
			visualCategory: 'mistakes',
		};
	}

	return {
		concept: `${focus.toLowerCase()} process`,
		query: `${subj} ${focus.toLowerCase()}`,
		altHint: focus,
		visualCategory: 'process_generic',
	};
}

function featuredConcept(article, articleType) {
	const subject = titleSubject(article);
	if (articleType === 'recipe') {
		return {
			concept: 'finished plated dish',
			query: `${subject} plated finished dish`,
			altHint: `${subject} served on a plate`,
			visualCategory: 'plated_finished',
		};
	}
	if (articleType === 'how-to') {
		return {
			concept: 'completed how-to result',
			query: `${subject} finished result`,
			altHint: `Finished result of ${subject}`,
			visualCategory: 'howto_result',
		};
	}
	if (articleType === 'listicle') {
		return {
			concept: 'collection overview hero',
			query: `${subject} assortment flat lay`,
			altHint: `Assortment of ${subject}`,
			visualCategory: 'collection_hero',
		};
	}
	if (articleType === 'review') {
		return {
			concept: 'review subject hero',
			query: `${subject} product hero photo`,
			altHint: subject,
			visualCategory: 'product_hero',
		};
	}
	if (articleType === 'comparison') {
		return {
			concept: 'comparison subjects overview',
			query: `${subject} side by side comparison`,
			altHint: subject,
			visualCategory: 'comparison',
		};
	}
	return {
		concept: 'topic hero scene',
		query: `${subject} lifestyle scene`,
		altHint: subject,
		visualCategory: 'topic_hero',
	};
}

function listicleConcept(heading, subject) {
	const focus = stripListNumbering(heading);
	const cleaned = focus || subject;
	return {
		concept: `list item: ${cleaned.toLowerCase()}`,
		query: cleaned.toLowerCase(),
		altHint: cleaned,
		visualCategory: 'list_item',
	};
}

function informationalConcept(heading, subject) {
	const focus = stripListNumbering(heading) || subject;
	return {
		concept: focus.toLowerCase(),
		query: `${subject} ${focus.toLowerCase()}`.replace(/\s+/g, ' ').trim(),
		altHint: focus,
		visualCategory: 'info_section',
	};
}

/**
 * Enrich a candidate with concept / query / altHint / visualCategory.
 * @param {object} candidate
 * @param {object} article
 * @param {string} articleType
 */
export function enrichCandidateQuery(candidate, article = {}, articleType = 'informational') {
	const subject = titleSubject(article);

	if (candidate.type === 'featured' || candidate.kind === 'featured') {
		const f = featuredConcept(article, articleType);
		return { ...candidate, ...f };
	}

	if (candidate.kind === 'intro') {
		return {
			...candidate,
			concept: 'article context visual',
			query: `${subject} lifestyle context`,
			altHint: subject,
			visualCategory: 'context',
		};
	}

	const heading = candidate.heading || '';
	if (articleType === 'recipe') {
		return { ...candidate, ...recipeConceptFromHeading(heading, subject) };
	}
	if (articleType === 'how-to') {
		return { ...candidate, ...howtoConceptFromHeading(heading, subject) };
	}
	if (articleType === 'listicle') {
		return { ...candidate, ...listicleConcept(heading, subject) };
	}
	return { ...candidate, ...informationalConcept(heading, subject) };
}

export function enrichCandidates(candidates, article, articleType) {
	return (Array.isArray(candidates) ? candidates : []).map((c) =>
		enrichCandidateQuery(c, article, articleType),
	);
}

/**
 * Future AI semantic planner hook — M1 is a no-op pass-through.
 * @param {Array<object>} enrichedCandidates
 * @param {object} _article
 * @param {object} [_context]
 */
export function applySemanticPlanner(enrichedCandidates, _article, _context = {}) {
	return enrichedCandidates;
}
