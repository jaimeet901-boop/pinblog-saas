/**
 * Pure decision helpers for stock → Fal fallback (M2-B).
 * No network I/O. No retry loops. No stock↔Fal ping-pong.
 */

/**
 * After a stock attempt, decide next action.
 * @param {{
 *   stockResolved?: boolean,
 *   allowFal?: boolean,
 *   falBudgetRemaining?: number,
 * }} options
 * @returns {'done'|'fal'|'skip'}
 */
export function decideAfterStock({
	stockResolved = false,
	allowFal = false,
	falBudgetRemaining = 0,
} = {}) {
	if (stockResolved) return 'done';
	if (!allowFal) return 'skip';
	if (!Number.isFinite(falBudgetRemaining) || falBudgetRemaining <= 0) return 'skip';
	return 'fal';
}

/**
 * @deprecated Prefer decideAfterStock — kept for M2-A tests / Fal-only callers.
 * @param {{ allowFal?: boolean, falBudgetRemaining?: number }} options
 * @returns {'fal'|'skip'}
 */
export function decideSlotProviderPath({ allowFal = false, falBudgetRemaining = 0 } = {}) {
	if (!allowFal) return 'skip';
	if (!Number.isFinite(falBudgetRemaining) || falBudgetRemaining <= 0) return 'skip';
	return 'fal';
}

/**
 * Clamp maxFalImages to a safe range.
 * @param {unknown} value
 * @param {number} absoluteMax
 * @param {number} fallback
 */
export function clampMaxFalImages(value, absoluteMax = 5, fallback = 3) {
	const n = Number(value);
	if (!Number.isFinite(n)) return Math.min(absoluteMax, fallback);
	return Math.max(0, Math.min(absoluteMax, Math.floor(n)));
}

/**
 * Normalize allowFal flag.
 * @param {unknown} value
 */
export function normalizeAllowFal(value) {
	return value === true || value === 1 || value === '1' || value === 'true';
}

/**
 * Stock is preferred when not explicitly disabled.
 * @param {unknown} value
 */
export function normalizeAllowStock(value) {
	if (value === false || value === 0 || value === '0' || value === 'false') return false;
	return true;
}
