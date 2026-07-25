/**
 * Template editor store — isolated from React components.
 * Components subscribe via useSyncExternalStore; all mutations go through commands.
 */

import {
	createEmptyLayerDocument,
	isV2Document,
	normalizeEditorDocument,
} from '@/lib/pinLayerSchema';
import { migrateV1ProceduralToV2 } from '@/lib/pinLayerMigrate';
import { hashTemplateConfiguration } from '@/lib/pinTemplateIdentity';
import {
	applyEditorCommand,
	invertEditorCommand,
	prepareCommand,
} from './editorCommands';
import { createAutosaveController } from './editorAutosave';
import {
	canRedo,
	canUndo,
	createHistoryState,
	pushHistory,
	redoHistory,
	undoHistory,
} from './editorHistory';
import {
	createEditorExtensionsState,
	notifyExtensionsAfterCommand,
} from './editorExtensions';

function createInitialState() {
	return {
		templateId: null,
		templateUuid: null,
		name: 'Untitled template',
		revision: 1,
		document: createEmptyLayerDocument(),
		selection: {
			layerIds: [],
			groupIds: [],
			marquee: null,
		},
		ui: {
			zoom: 0.45,
			panX: 0,
			panY: 0,
			tool: 'select',
			leftPanel: 'layers',
			previewUrl: null,
			previewBusy: false,
		},
		history: createHistoryState(),
		dirty: false,
		autosave: {
			status: 'idle',
			lastSavedChecksum: null,
			lastError: null,
		},
		extensions: createEditorExtensionsState(),
		meta: {
			loadedAt: null,
			sourceKind: 'layers',
		},
	};
}

let state = createInitialState();
const listeners = new Set();
let autosaveController = createAutosaveController({
	getDocument: () => state.document,
	getChecksum: () => hashTemplateConfiguration(state.document),
});

autosaveController.subscribe((status) => {
	state = {
		...state,
		autosave: {
			status: status.status,
			lastSavedChecksum: status.lastSavedChecksum,
			lastError: status.lastError,
		},
	};
	emit();
});

function emit() {
	for (const listener of listeners) listener();
}

function setState(partial) {
	state = { ...state, ...partial };
	emit();
}

export function getEditorState() {
	return state;
}

export function subscribeEditor(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function resetEditorStore() {
	autosaveController.cancel();
	state = createInitialState();
	emit();
}

/**
 * Load a template into the editor. v1 configs are converted in-memory only (not forced save).
 */
export function loadEditorSession({
	templateId = null,
	templateUuid = null,
	name = 'Untitled template',
	revision = 1,
	configuration,
} = {}) {
	let document;
	let sourceKind = 'layers';
	if (isV2Document(configuration)) {
		document = normalizeEditorDocument(configuration);
	} else if (configuration && typeof configuration === 'object') {
		document = migrateV1ProceduralToV2(configuration);
		sourceKind = 'procedural-converted';
	} else {
		document = createEmptyLayerDocument();
	}

	autosaveController.cancel();
	state = {
		...createInitialState(),
		templateId,
		templateUuid,
		name,
		revision: Number(revision) > 0 ? Number(revision) : 1,
		document,
		meta: {
			loadedAt: Date.now(),
			sourceKind,
		},
	};
	emit();
}

/**
 * Dispatch a typed document command (undoable). Never pass raw JSON patches from UI.
 */
export function dispatchEditorCommand(rawCommand, options = {}) {
	const prepared = prepareCommand(state.document, rawCommand);
	const inverse = invertEditorCommand(prepared);
	if (!inverse && !options.allowNonUndoable) {
		throw new Error(`Command is not undoable: ${rawCommand?.type}`);
	}

	const nextDocument = applyEditorCommand(state.document, prepared);
	const history = inverse
		? pushHistory(state.history, { command: prepared, inverse })
		: state.history;

	state = {
		...state,
		document: nextDocument,
		history,
		dirty: true,
	};

	if (options.clearSelection) {
		state = {
			...state,
			selection: { layerIds: [], groupIds: [], marquee: null },
		};
	}

	notifyExtensionsAfterCommand({
		command: prepared,
		document: state.document,
		selection: state.selection,
	});

	// Integration point only — no save implementation
	autosaveController.schedule();
	emit();
	return state.document;
}

export function undoEditor() {
	const { history, entry } = undoHistory(state.history);
	if (!entry?.inverse) return false;
	state = {
		...state,
		document: applyEditorCommand(state.document, entry.inverse),
		history,
		dirty: true,
	};
	autosaveController.schedule();
	emit();
	return true;
}

export function redoEditor() {
	const { history, entry } = redoHistory(state.history);
	if (!entry?.command) return false;
	state = {
		...state,
		document: applyEditorCommand(state.document, entry.command),
		history,
		dirty: true,
	};
	autosaveController.schedule();
	emit();
	return true;
}

export function setEditorSelection({ layerIds = [], groupIds = [], marquee = null } = {}) {
	state = {
		...state,
		selection: {
			layerIds: [...new Set(layerIds)],
			groupIds: [...new Set(groupIds)],
			marquee,
		},
	};
	emit();
}

/**
 * Resolve group select: selecting a grouped layer can expand to all siblings.
 */
export function selectLayers(layerIds, { additive = false, groupAware = true } = {}) {
	let ids = [...layerIds];
	if (groupAware) {
		const expanded = new Set(ids);
		for (const id of ids) {
			const layer = state.document.layers.find((item) => item.id === id);
			if (!layer?.groupId) continue;
			const group = (state.document.groups || []).find((g) => g.id === layer.groupId);
			if (group) {
				for (const childId of group.childIds || []) expanded.add(childId);
			}
		}
		ids = [...expanded];
	}

	const next = additive
		? [...new Set([...state.selection.layerIds, ...ids])]
		: ids;

	const groupIds = [];
	for (const group of state.document.groups || []) {
		if ((group.childIds || []).every((id) => next.includes(id)) && group.childIds?.length) {
			groupIds.push(group.id);
		}
	}

	setEditorSelection({ layerIds: next, groupIds, marquee: null });
}

export function setEditorUi(partial) {
	state = {
		...state,
		ui: { ...state.ui, ...partial },
	};
	emit();
}

export function setEditorName(name) {
	state = { ...state, name: String(name || 'Untitled template'), dirty: true };
	autosaveController.schedule();
	emit();
}

export function setExtensionEnabled(id, enabled) {
	if (!(id in state.extensions)) return;
	state = {
		...state,
		extensions: {
			...state.extensions,
			[id]: { ...state.extensions[id], enabled: Boolean(enabled) },
		},
	};
	emit();
}

export function getEditorAutosaveController() {
	return autosaveController;
}

/** Wire persistence later without rewriting store internals. */
export function bindEditorAutosave(handlers) {
	autosaveController.bindGetters({
		getDocument: () => state.document,
		getChecksum: () => hashTemplateConfiguration(state.document),
		...handlers,
	});
}

export function markEditorSaved({ checksum, revision } = {}) {
	autosaveController.markSaved(checksum);
	state = {
		...state,
		dirty: false,
		revision: revision != null ? Number(revision) : state.revision,
		autosave: {
			...state.autosave,
			status: 'saved',
			lastSavedChecksum: checksum || state.autosave.lastSavedChecksum,
		},
	};
	emit();
}

export function editorCanUndo() {
	return canUndo(state.history);
}

export function editorCanRedo() {
	return canRedo(state.history);
}

export function getSelectedLayers() {
	const ids = new Set(state.selection.layerIds);
	return state.document.layers.filter((layer) => ids.has(layer.id));
}
