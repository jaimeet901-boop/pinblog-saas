/**
 * Undo / redo history — stores deterministic command pairs for future collab sync.
 */

const DEFAULT_LIMIT = 100;

/**
 * @param {{ limit?: number }} [options]
 */
export function createHistoryState(options = {}) {
	return {
		past: [],
		future: [],
		limit: options.limit ?? DEFAULT_LIMIT,
	};
}

/**
 * @param {object} history
 * @param {{ command: object, inverse: object }} entry
 */
export function pushHistory(history, entry) {
	const past = [...history.past, entry];
	while (past.length > history.limit) past.shift();
	return {
		...history,
		past,
		future: [],
	};
}

export function undoHistory(history) {
	if (!history.past.length) {
		return { history, entry: null };
	}
	const past = [...history.past];
	const entry = past.pop();
	return {
		history: {
			...history,
			past,
			future: [entry, ...history.future],
		},
		entry,
	};
}

export function redoHistory(history) {
	if (!history.future.length) {
		return { history, entry: null };
	}
	const [entry, ...future] = history.future;
	return {
		history: {
			...history,
			past: [...history.past, entry],
			future,
		},
		entry,
	};
}

export function canUndo(history) {
	return Boolean(history?.past?.length);
}

export function canRedo(history) {
	return Boolean(history?.future?.length);
}
