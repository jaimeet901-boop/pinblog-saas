import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import {
	dispatchEditorCommand,
	editorCanRedo,
	editorCanUndo,
	getEditorState,
	getSelectedLayers,
	redoEditor,
	selectLayers,
	setEditorSelection,
	subscribeEditor,
	undoEditor,
	createDeleteCommand,
	createDuplicateCommand,
	createGroupCommand,
	createUngroupCommand,
	createVisibilityCommand,
	createLockCommand,
	createMoveCommand,
	createAddLayerCommand,
	createReorderCommand,
	createRenameCommand,
	createSetPropsCommand,
} from '@/services/templates';

/**
 * Selector-aware subscription — only re-renders when selected slice changes (Object.is).
 */
export function useEditorStore(selector = (s) => s) {
	const selectorRef = useRef(selector);
	selectorRef.current = selector;
	const lastRef = useRef({ state: null, selected: null });

	return useSyncExternalStore(
		subscribeEditor,
		() => {
			const nextState = getEditorState();
			const nextSelected = selectorRef.current(nextState);
			if (
				lastRef.current.state === nextState
				|| Object.is(lastRef.current.selected, nextSelected)
			) {
				if (lastRef.current.state !== nextState) {
					lastRef.current = { state: nextState, selected: nextSelected };
				}
				return lastRef.current.selected;
			}
			lastRef.current = { state: nextState, selected: nextSelected };
			return nextSelected;
		},
		() => selectorRef.current(getEditorState()),
	);
}

export function useEditorActions() {
	return useMemo(() => ({
		dispatch: dispatchEditorCommand,
		undo: undoEditor,
		redo: redoEditor,
		selectLayers,
		setSelection: setEditorSelection,
		deleteSelection() {
			const { selection } = getEditorState();
			if (!selection.layerIds.length) return;
			dispatchEditorCommand(createDeleteCommand(selection.layerIds), { clearSelection: true });
		},
		duplicateSelection() {
			const { selection } = getEditorState();
			if (!selection.layerIds.length) return;
			dispatchEditorCommand(createDuplicateCommand(selection.layerIds));
		},
		groupSelection() {
			const { selection } = getEditorState();
			if (selection.layerIds.length < 2) return;
			dispatchEditorCommand(createGroupCommand(selection.layerIds));
		},
		ungroupSelection() {
			const { selection, document } = getEditorState();
			const groupIds = selection.groupIds.length
				? selection.groupIds
				: [...new Set(
					document.layers
						.filter((layer) => selection.layerIds.includes(layer.id) && layer.groupId)
						.map((layer) => layer.groupId),
				)];
			if (!groupIds.length) return;
			dispatchEditorCommand(createUngroupCommand(groupIds));
		},
		hideSelection() {
			const { selection } = getEditorState();
			if (!selection.layerIds.length) return;
			dispatchEditorCommand(createVisibilityCommand(selection.layerIds, false));
		},
		showSelection() {
			const { selection } = getEditorState();
			if (!selection.layerIds.length) return;
			dispatchEditorCommand(createVisibilityCommand(selection.layerIds, true));
		},
		lockSelection() {
			const { selection } = getEditorState();
			if (!selection.layerIds.length) return;
			dispatchEditorCommand(createLockCommand(selection.layerIds, true));
		},
		unlockSelection() {
			const { selection } = getEditorState();
			if (!selection.layerIds.length) return;
			dispatchEditorCommand(createLockCommand(selection.layerIds, false));
		},
		nudge(dx, dy) {
			const { selection } = getEditorState();
			if (!selection.layerIds.length) return;
			dispatchEditorCommand(createMoveCommand(selection.layerIds, dx, dy));
		},
		selectAll() {
			const { document } = getEditorState();
			selectLayers(document.layers.map((layer) => layer.id), { groupAware: false });
		},
		addLayer(type) {
			dispatchEditorCommand(createAddLayerCommand(type));
		},
		reorder(order) {
			dispatchEditorCommand(createReorderCommand(order));
		},
		rename(layerId, name) {
			dispatchEditorCommand(createRenameCommand(layerId, name));
		},
		setProps(layerId, props) {
			dispatchEditorCommand(createSetPropsCommand(layerId, props));
		},
	}), []);
}

export function useEditorShortcutContext() {
	const actions = useEditorActions();
	return useCallback(() => ({
		...actions,
		canUndo: editorCanUndo(),
		canRedo: editorCanRedo(),
		getSelectedLayers,
	}), [actions]);
}
