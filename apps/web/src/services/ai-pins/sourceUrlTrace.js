/**
 * Trace ai_pins.source_url / destination URL through generate → save → publish.
 */

export function traceSourceUrl(stage, payload = {}) {
	const sourceUrl = payload.sourceUrl ?? payload.source_url ?? null;
	const entry = {
		stage,
		sourceUrl: sourceUrl == null ? sourceUrl : String(sourceUrl),
		empty: !String(sourceUrl || '').trim(),
		pinId: payload.pinId || payload.id || null,
		tempId: payload.tempId || null,
		articleId: payload.articleId || null,
		file: payload.file || '',
		function: payload.functionName || '',
		line: payload.lineNumber || null,
		meta: payload.meta || undefined,
	};
	// eslint-disable-next-line no-console
	console.info('[source-url]', entry);
	return entry;
}
