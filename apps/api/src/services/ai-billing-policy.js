/** Pure billing policy helpers for AI generation results (no I/O). */

/** True when the AI runtime produced a billable result (not heuristic/template-only fallback). */
export function isBillableAiResultSource(source) {
	const normalized = String(source || '').trim().toLowerCase();
	if (!normalized) return false;
	if (normalized === 'heuristic' || normalized === 'template') return false;
	return true;
}
