/**
 * Writer leave / refresh protection helpers (High Priority #1).
 * Keep guards active during AI generation even when article is temporarily cleared for streaming UI.
 */

/**
 * Whether the in-editor article differs from the last successful Save/Publish fingerprint.
 * Returns false when there is no article (caller must combine with generation/stream guards).
 */
export function isArticleContentDirty({
	article = null,
	currentFingerprint = null,
	savedFingerprint = null,
} = {}) {
	if (!article) return false;
	if (!savedFingerprint) return true;
	return currentFingerprint !== savedFingerprint;
}

/**
 * True when the user should be warned before leaving / refreshing Writer.
 */
export function shouldWarnOnLeave({
	articleDirty = false,
	generating = false,
	genPhase = 'idle',
	stream = '',
} = {}) {
	if (generating) return true;
	if (genPhase === 'cancelling') return true;
	if (articleDirty) return true;
	const hasStream = Boolean(String(stream || '').trim());
	if (hasStream && (genPhase === 'failed' || genPhase === 'cancelled')) return true;
	return false;
}

/**
 * Snapshot prior editor state before clearing article for streaming generation.
 * Restored on cancel/fail so edited content is not lost.
 */
export function captureGenerationSnapshot({
	article = null,
	articleBaseline = null,
	savedFingerprint = null,
} = {}) {
	if (!article) return null;
	return {
		article,
		articleBaseline: articleBaseline ?? article,
		savedFingerprint,
	};
}

/**
 * Decide post-generation editor restore.
 * - success → keep new article (no restore)
 * - cancel/fail → restore snapshot when present
 */
export function resolveGenerationEditorRestore({
	outcome = 'success',
	snapshot = null,
} = {}) {
	if (outcome === 'success') {
		return { restore: false, snapshot: null };
	}
	if (snapshot?.article) {
		return { restore: true, snapshot };
	}
	return { restore: false, snapshot: null };
}

/**
 * After Save Draft success, dirty must clear (fingerprint matches current).
 */
export function isDirtyAfterSuccessfulSave({
	article,
	currentFingerprint,
	savedFingerprint,
}) {
	if (!article || !savedFingerprint) return false;
	return currentFingerprint !== savedFingerprint;
}

/**
 * Publish/Schedule: dirty clears only after a successful persist fingerprint write.
 */
export function shouldClearDirtyAfterPublish({ persistSucceeded = false } = {}) {
	return Boolean(persistSucceeded);
}
