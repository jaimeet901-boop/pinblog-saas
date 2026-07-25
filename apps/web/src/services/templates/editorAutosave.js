/**
 * Auto-save controller — wire `onSave` from the editor page (persistence).
 */

/**
 * @typedef {'idle'|'scheduled'|'saving'|'saved'|'error'} AutosaveStatus
 */

/**
 * @param {object} options
 * @param {() => object} options.getDocument
 * @param {() => Promise<string>|string} [options.getChecksum]
 * @param {(payload: { document: object, checksum: string }) => Promise<void>} [options.onSave]
 * @param {number} [options.debounceMs]
 */
export function createAutosaveController(options = {}) {
	const debounceMs = options.debounceMs ?? 2000;
	let timer = null;
	let status = 'idle';
	let lastError = null;
	let lastSavedChecksum = null;
	const listeners = new Set();

	function emit() {
		for (const listener of listeners) {
			listener(getStatus());
		}
	}

	function getStatus() {
		return {
			status,
			lastError,
			lastSavedChecksum,
			debounceMs,
		};
	}

	function setStatus(next, error = null) {
		status = next;
		lastError = error;
		emit();
	}

	async function flush() {
		if (typeof options.onSave !== 'function') {
			setStatus('idle');
			return { skipped: true };
		}
		clearTimeout(timer);
		timer = null;
		setStatus('saving');
		try {
			const document = options.getDocument();
			const checksum = await Promise.resolve(
				typeof options.getChecksum === 'function'
					? options.getChecksum()
					: '',
			);
			await options.onSave({ document, checksum });
			lastSavedChecksum = checksum || lastSavedChecksum;
			setStatus('saved');
			return { ok: true, checksum };
		} catch (error) {
			setStatus('error', error);
			return { ok: false, error };
		}
	}

	function schedule() {
		if (typeof options.onSave !== 'function') {
			setStatus('idle');
			return;
		}
		setStatus('scheduled');
		clearTimeout(timer);
		timer = setTimeout(() => {
			flush();
		}, debounceMs);
	}

	function cancel() {
		clearTimeout(timer);
		timer = null;
		if (status === 'scheduled') setStatus('idle');
	}

	function subscribe(listener) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	/** Checkpoint after a successful external save (manual Save). */
	function markSaved(checksum) {
		lastSavedChecksum = checksum || lastSavedChecksum;
		setStatus('saved');
	}

	return {
		schedule,
		flush,
		cancel,
		subscribe,
		getStatus,
		markSaved,
		/** Reserved — collab / presence can observe dirty stream */
		bindGetters(next) {
			Object.assign(options, next);
		},
	};
}
