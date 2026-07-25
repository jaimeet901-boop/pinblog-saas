/**
 * Centralized keyboard shortcut manager for the template editor.
 */

/**
 * @typedef {{ id: string, chord: string, when?: (ctx) => boolean, run: (ctx) => void, preventDefault?: boolean }} ShortcutBinding
 */

const DEFAULT_BINDINGS = [
	{ id: 'undo', chord: 'mod+z', run: (ctx) => ctx.undo() },
	{ id: 'redo', chord: 'mod+shift+z', run: (ctx) => ctx.redo() },
	{ id: 'redoAlt', chord: 'mod+y', run: (ctx) => ctx.redo() },
	{ id: 'delete', chord: 'delete', run: (ctx) => ctx.deleteSelection() },
	{ id: 'backspaceDelete', chord: 'backspace', run: (ctx) => ctx.deleteSelection() },
	{ id: 'duplicate', chord: 'mod+d', run: (ctx) => ctx.duplicateSelection() },
	{ id: 'selectAll', chord: 'mod+a', run: (ctx) => ctx.selectAll() },
	{ id: 'group', chord: 'mod+g', run: (ctx) => ctx.groupSelection() },
	{ id: 'ungroup', chord: 'mod+shift+g', run: (ctx) => ctx.ungroupSelection() },
	{ id: 'hide', chord: 'mod+shift+h', run: (ctx) => ctx.hideSelection() },
	{ id: 'lock', chord: 'mod+shift+l', run: (ctx) => ctx.lockSelection() },
	{ id: 'nudgeLeft', chord: 'arrowleft', run: (ctx) => ctx.nudge(-1, 0) },
	{ id: 'nudgeRight', chord: 'arrowright', run: (ctx) => ctx.nudge(1, 0) },
	{ id: 'nudgeUp', chord: 'arrowup', run: (ctx) => ctx.nudge(0, -1) },
	{ id: 'nudgeDown', chord: 'arrowdown', run: (ctx) => ctx.nudge(0, 1) },
	{ id: 'nudgeLeft10', chord: 'shift+arrowleft', run: (ctx) => ctx.nudge(-10, 0) },
	{ id: 'nudgeRight10', chord: 'shift+arrowright', run: (ctx) => ctx.nudge(10, 0) },
	{ id: 'nudgeUp10', chord: 'shift+arrowup', run: (ctx) => ctx.nudge(0, -10) },
	{ id: 'nudgeDown10', chord: 'shift+arrowdown', run: (ctx) => ctx.nudge(0, 10) },
];

function normalizeChord(event) {
	const parts = [];
	const mod = event.metaKey || event.ctrlKey;
	if (mod) parts.push('mod');
	if (event.shiftKey) parts.push('shift');
	if (event.altKey) parts.push('alt');
	const key = String(event.key || '').toLowerCase();
	if (key && !['control', 'meta', 'shift', 'alt'].includes(key)) {
		parts.push(key === ' ' ? 'space' : key);
	}
	return parts.join('+');
}

function isEditableTarget(target) {
	if (!target) return false;
	if (typeof Element !== 'undefined' && target instanceof Element) {
		const tag = target.tagName?.toLowerCase();
		if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
		return Boolean(target.closest?.('[contenteditable="true"]'));
	}
	const tag = String(target.tagName || '').toLowerCase();
	return tag === 'input' || tag === 'textarea' || tag === 'select';
}

/**
 * @param {ShortcutBinding[]} [extra]
 */
export function createEditorShortcutManager(extra = []) {
	const bindings = [...DEFAULT_BINDINGS, ...extra];
	const byChord = new Map();
	for (const binding of bindings) {
		const list = byChord.get(binding.chord) || [];
		list.push(binding);
		byChord.set(binding.chord, list);
	}

	function handleKeyDown(event, ctx) {
		if (isEditableTarget(event.target) && !event.metaKey && !event.ctrlKey) {
			return false;
		}
		const chord = normalizeChord(event);
		const matches = byChord.get(chord) || [];
		for (const binding of matches) {
			if (binding.when && !binding.when(ctx)) continue;
			if (binding.preventDefault !== false) event.preventDefault();
			binding.run(ctx);
			return true;
		}
		return false;
	}

	function listBindings() {
		return bindings.map(({ id, chord }) => ({ id, chord }));
	}

	return {
		handleKeyDown,
		listBindings,
		register(binding) {
			bindings.push(binding);
			const list = byChord.get(binding.chord) || [];
			list.push(binding);
			byChord.set(binding.chord, list);
		},
	};
}
