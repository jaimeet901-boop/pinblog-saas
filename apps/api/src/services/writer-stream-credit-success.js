/**
 * AI-WRITER-02 — settle integrated-ai/stream credits from Writer output, not token count.
 *
 * Billable ai_writer commits only when accumulated text is usable Writer JSON.
 * Empty / malformed JSON / provider failure → release.
 * Pin copy keeps non-empty streamed text (not the Writer article contract).
 * Continuation is free at the reservation layer; this helper is not used there.
 */

import { PIN_COPY_CREDIT_FEATURE, WRITER_CREDIT_FEATURE } from './integrated-ai-stream-credits.js';

/**
 * Same extraction rule as apps/web/src/lib/aiGenerate.js extractJson.
 * Do not accept prose or truncated objects as success.
 */
export function extractWriterJson(text) {
	if (!text) return null;
	let t = String(text).trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
	const start = t.indexOf('{');
	const end = t.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) return null;
	try {
		const parsed = JSON.parse(t.slice(start, end + 1));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

function isNonEmptyString(value) {
	return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Existing Writer article JSON contract (system prompt), practical for settlement:
 * parseable object with article fields the studio actually renders.
 * Does not require recipe_schema so existing successful articles that omit it still commit.
 */
export function isValidWriterArticleJson(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const hasTitle = typeof value.seo_title === 'string';
	const hasIntro = typeof value.introduction === 'string';
	const hasConclusion = typeof value.conclusion === 'string';
	const hasSections = Array.isArray(value.sections);
	if (!hasTitle && !hasIntro && !hasConclusion) return false;
	if (!hasSections && !hasIntro) return false;
	return true;
}

/**
 * Section-AI JSON shapes from WriterSectionBlocks (unchanged billing: still ai_writer).
 * Used only when the request is not a length-enforced article generation.
 */
export function isValidWriterSectionJson(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	if (isNonEmptyString(value.content)) return true;
	if (isNonEmptyString(value.heading) && typeof value.content === 'string') return true;
	if (Array.isArray(value.faq) && value.faq.some((item) => (
		isNonEmptyString(item?.question) || isNonEmptyString(item?.answer)
	))) {
		return true;
	}
	return false;
}

export function isStreamAbortError(error) {
	if (!error) return false;
	const code = String(error.code || error.errno || '');
	if (code === 'ERR_STREAM_DESTROYED' || code === 'ABORT_ERR') return true;
	const name = String(error.name || '');
	if (name === 'AbortError') return true;
	return /destroyed|aborted/i.test(String(error.message || ''));
}

/**
 * Single settlement: commit XOR release. Later calls are no-ops.
 */
export function createOnceCreditSettle(settle) {
	let settled = false;
	return async (payload = {}) => {
		if (settled) {
			return { skipped: true, settled: true };
		}
		settled = true;
		if (typeof settle !== 'function') {
			return { skipped: false, settled: true, result: null };
		}
		const result = await settle(payload);
		return { skipped: false, settled: true, result };
	};
}

/**
 * @returns {boolean} true → commit reservation, false → release
 */
export function evaluateIntegratedAiStreamCreditSuccess({
	providerFailed = false,
	accumulatedText = '',
	contentEventCount = 0,
	creditFeature = '',
	requireWriterArticleJson = false,
} = {}) {
	if (providerFailed) return false;

	const feature = String(creditFeature || '').trim().toLowerCase();
	const text = String(accumulatedText || '');
	const events = Number(contentEventCount) || 0;

	if (feature === PIN_COPY_CREDIT_FEATURE) {
		return events > 0 && text.trim().length > 0;
	}

	if (feature === WRITER_CREDIT_FEATURE || requireWriterArticleJson) {
		if (!text.trim()) return false;
		const json = extractWriterJson(text);
		if (!json) return false;
		if (requireWriterArticleJson) return isValidWriterArticleJson(json);
		return isValidWriterArticleJson(json) || isValidWriterSectionJson(json);
	}

	return events > 0 && text.trim().length > 0;
}

export function joinSseContentEvents(contentEvents = []) {
	if (!Array.isArray(contentEvents) || contentEvents.length === 0) return '';
	return contentEvents.map((event) => String(event?.data?.content || '')).join('');
}
