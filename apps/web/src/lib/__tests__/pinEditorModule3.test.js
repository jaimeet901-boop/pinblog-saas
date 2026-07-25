import { describe, expect, it, beforeEach } from 'vitest';
import {
	EditorCommandType,
	applyEditorCommand,
	createDeleteCommand,
	createDuplicateCommand,
	createGroupCommand,
	createLockCommand,
	createMoveCommand,
	createRenameCommand,
	createReorderCommand,
	createResizeCommand,
	createRotateCommand,
	createUngroupCommand,
	createVisibilityCommand,
	invertEditorCommand,
	prepareCommand,
} from '../../services/templates/editorCommands.js';
import {
	canRedo,
	canUndo,
	createHistoryState,
	pushHistory,
	redoHistory,
	undoHistory,
} from '../../services/templates/editorHistory.js';
import { createAutosaveController } from '../../services/templates/editorAutosave.js';
import { createEditorShortcutManager } from '../../services/templates/editorShortcuts.js';
import {
	dispatchEditorCommand,
	editorCanRedo,
	editorCanUndo,
	getEditorState,
	loadEditorSession,
	resetEditorStore,
	selectLayers,
	undoEditor,
	redoEditor,
} from '../../services/templates/editorStore.js';
import { createEmptyLayerDocument } from '../pinLayerSchema.js';
import { createLayer } from '../../services/templates/layerFactory.js';
import { createDefaultTemplateConfig } from '../pinTemplates.js';

function docWithLayers(layers) {
	return {
		...createEmptyLayerDocument(),
		layers,
	};
}

describe('editorCommands', () => {
	it('applies move/resize/rotate/reorder/duplicate/delete deterministically', () => {
		const a = createLayer('text', { id: 'lyr_a', x: 10, y: 20 });
		const b = createLayer('shape', { id: 'lyr_b', x: 40, y: 50 });
		let doc = docWithLayers([a, b]);

		doc = applyEditorCommand(doc, createMoveCommand(['lyr_a'], 5, -2));
		expect(doc.layers.find((l) => l.id === 'lyr_a')).toMatchObject({ x: 15, y: 18 });

		doc = applyEditorCommand(doc, prepareCommand(doc, createResizeCommand(['lyr_b'], {
			lyr_b: { x: 40, y: 50, width: 300, height: 120 },
		})));
		expect(doc.layers.find((l) => l.id === 'lyr_b').width).toBe(300);

		doc = applyEditorCommand(doc, createRotateCommand(['lyr_a'], { lyr_a: 15 }));
		expect(doc.layers.find((l) => l.id === 'lyr_a').rotation).toBe(15);

		doc = applyEditorCommand(doc, prepareCommand(doc, createReorderCommand(['lyr_b', 'lyr_a'])));
		expect(doc.layers.map((l) => l.id)).toEqual(['lyr_b', 'lyr_a']);

		const dup = prepareCommand(doc, createDuplicateCommand(['lyr_a']));
		doc = applyEditorCommand(doc, dup);
		expect(doc.layers).toHaveLength(3);

		doc = applyEditorCommand(doc, prepareCommand(doc, createDeleteCommand([dup.newIds.lyr_a])));
		expect(doc.layers).toHaveLength(2);
	});

	it('supports lock/unlock/hide/show/rename/group/ungroup', () => {
		const a = createLayer('text', { id: 'lyr_a' });
		const b = createLayer('text', { id: 'lyr_b' });
		let doc = docWithLayers([a, b]);

		doc = applyEditorCommand(doc, createLockCommand(['lyr_a'], true));
		expect(doc.layers.find((l) => l.id === 'lyr_a').locked).toBe(true);
		doc = applyEditorCommand(doc, createVisibilityCommand(['lyr_b'], false));
		expect(doc.layers.find((l) => l.id === 'lyr_b').visible).toBe(false);
		doc = applyEditorCommand(doc, prepareCommand(doc, createRenameCommand('lyr_a', 'Hero')));
		expect(doc.layers.find((l) => l.id === 'lyr_a').name).toBe('Hero');

		const groupCmd = prepareCommand(doc, createGroupCommand(['lyr_a', 'lyr_b'], 'Block'));
		doc = applyEditorCommand(doc, groupCmd);
		expect(doc.groups[0].childIds).toEqual(['lyr_a', 'lyr_b']);
		doc = applyEditorCommand(doc, prepareCommand(doc, createUngroupCommand([groupCmd.groupId])));
		expect(doc.groups).toHaveLength(0);
		expect(doc.layers.every((l) => !l.groupId)).toBe(true);
	});

	it('inverts move for undo', () => {
		const cmd = createMoveCommand(['lyr_a'], 10, 4);
		const inverse = invertEditorCommand(cmd);
		expect(inverse).toEqual({
			type: EditorCommandType.MOVE,
			layerIds: ['lyr_a'],
			dx: -10,
			dy: -4,
		});
	});
});

describe('editorHistory', () => {
	it('undo/redo stack works', () => {
		let history = createHistoryState({ limit: 3 });
		history = pushHistory(history, { command: { type: 'a' }, inverse: { type: 'a-inv' } });
		history = pushHistory(history, { command: { type: 'b' }, inverse: { type: 'b-inv' } });
		expect(canUndo(history)).toBe(true);
		const u = undoHistory(history);
		expect(u.entry.inverse.type).toBe('b-inv');
		expect(canRedo(u.history)).toBe(true);
		const r = redoHistory(u.history);
		expect(r.entry.command.type).toBe('b');
	});
});

describe('editorAutosave integration points', () => {
	it('schedules and flushes when onSave is bound', async () => {
		const saves = [];
		const controller = createAutosaveController({
			debounceMs: 10,
			getDocument: () => ({ ok: true }),
			getChecksum: async () => 'abc',
			onSave: async (payload) => { saves.push(payload); },
		});
		controller.schedule();
		expect(controller.getStatus().status).toBe('scheduled');
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(saves).toHaveLength(1);
		expect(saves[0].checksum).toBe('abc');
	});

	it('skips network when onSave missing', async () => {
		const controller = createAutosaveController({
			getDocument: () => ({}),
		});
		controller.schedule();
		const result = await controller.flush();
		expect(result.skipped).toBe(true);
	});
});

describe('editorShortcuts', () => {
	it('routes chords through centralized manager', () => {
		const calls = [];
		const manager = createEditorShortcutManager();
		const event = {
			key: 'z',
			metaKey: true,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			target: { tagName: 'DIV' },
			preventDefault() { calls.push('prevent'); },
		};
		const handled = manager.handleKeyDown(event, {
			undo: () => calls.push('undo'),
			redo: () => {},
			deleteSelection: () => {},
			duplicateSelection: () => {},
			selectAll: () => {},
			groupSelection: () => {},
			ungroupSelection: () => {},
			hideSelection: () => {},
			lockSelection: () => {},
			nudge: () => {},
		});
		expect(handled).toBe(true);
		expect(calls).toContain('undo');
	});
});

describe('editorStore', () => {
	beforeEach(() => {
		resetEditorStore();
	});

	it('keeps state outside React and supports undoable commands', () => {
		loadEditorSession({ name: 'Demo', configuration: null });
		dispatchEditorCommand({
			type: EditorCommandType.ADD,
			layerType: 'text',
		});
		expect(getEditorState().document.layers.length).toBe(1);
		expect(getEditorState().dirty).toBe(true);
		expect(editorCanUndo()).toBe(true);
		undoEditor();
		expect(getEditorState().document.layers.length).toBe(0);
		expect(editorCanRedo()).toBe(true);
		redoEditor();
		expect(getEditorState().document.layers.length).toBe(1);
	});

	it('converts v1 procedural config in-memory only on load', () => {
		loadEditorSession({
			configuration: createDefaultTemplateConfig(),
		});
		expect(getEditorState().meta.sourceKind).toBe('procedural-converted');
		expect(getEditorState().document.editorVersion).toBe(2);
		expect(getEditorState().document.layers.length).toBeGreaterThan(0);
	});

	it('supports multi and group-aware selection', () => {
		loadEditorSession({ configuration: null });
		dispatchEditorCommand({ type: EditorCommandType.ADD, layerType: 'text' });
		dispatchEditorCommand({ type: EditorCommandType.ADD, layerType: 'shape' });
		const ids = getEditorState().document.layers.map((l) => l.id);
		dispatchEditorCommand(createGroupCommand(ids));
		selectLayers([ids[0]], { groupAware: true });
		expect(getEditorState().selection.layerIds.sort()).toEqual([...ids].sort());
	});
});
