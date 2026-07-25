/**
 * Typed editor commands — pure, deterministic, serializable for future collab.
 * The editor never mutates document JSON ad hoc; all edits go through these.
 */

import { createGroupId, createLayerId, normalizeEditorDocument } from '@/lib/pinLayerSchema';
import { createLayer } from './layerFactory';

export const EditorCommandType = Object.freeze({
	MOVE: 'layer.move',
	RESIZE: 'layer.resize',
	ROTATE: 'layer.rotate',
	REORDER: 'layer.reorder',
	DUPLICATE: 'layer.duplicate',
	DELETE: 'layer.delete',
	LOCK: 'layer.lock',
	UNLOCK: 'layer.unlock',
	HIDE: 'layer.hide',
	SHOW: 'layer.show',
	RENAME: 'layer.rename',
	GROUP: 'layer.group',
	UNGROUP: 'layer.ungroup',
	ADD: 'layer.add',
	SET_PROPS: 'layer.setProps',
	REPLACE_DOCUMENT: 'document.replace',
});

function cloneDoc(document) {
	return normalizeEditorDocument(structuredClone
		? structuredClone(document)
		: JSON.parse(JSON.stringify(document)));
}

function mapLayers(document, mapper) {
	return {
		...document,
		layers: document.layers.map(mapper),
	};
}

function findLayer(document, id) {
	return document.layers.find((layer) => layer.id === id) || null;
}

/**
 * Apply a command to a document. Pure: returns a new normalized document.
 * @param {object} document
 * @param {object} command
 */
export function applyEditorCommand(document, command) {
	const doc = cloneDoc(document);
	const type = command?.type;

	switch (type) {
		case EditorCommandType.MOVE: {
			const dx = Number(command.dx) || 0;
			const dy = Number(command.dy) || 0;
			const ids = new Set(command.layerIds || []);
			return mapLayers(doc, (layer) => {
				if (!ids.has(layer.id) || layer.locked) return layer;
				return { ...layer, x: layer.x + dx, y: layer.y + dy };
			});
		}
		case EditorCommandType.RESIZE: {
			const ids = new Set(command.layerIds || []);
			const patches = command.patches || {};
			return mapLayers(doc, (layer) => {
				if (!ids.has(layer.id) || layer.locked) return layer;
				const patch = patches[layer.id] || {};
				return {
					...layer,
					x: patch.x != null ? Number(patch.x) : layer.x,
					y: patch.y != null ? Number(patch.y) : layer.y,
					width: patch.width != null ? Math.max(1, Number(patch.width)) : layer.width,
					height: patch.height != null ? Math.max(1, Number(patch.height)) : layer.height,
				};
			});
		}
		case EditorCommandType.ROTATE: {
			const ids = new Set(command.layerIds || []);
			const rotationById = command.rotationById || {};
			const delta = Number(command.delta);
			return mapLayers(doc, (layer) => {
				if (!ids.has(layer.id) || layer.locked) return layer;
				if (rotationById[layer.id] != null) {
					return { ...layer, rotation: Number(rotationById[layer.id]) };
				}
				if (Number.isFinite(delta)) {
					return { ...layer, rotation: layer.rotation + delta };
				}
				return layer;
			});
		}
		case EditorCommandType.REORDER: {
			const order = Array.isArray(command.order) ? command.order : null;
			if (!order) return doc;
			const byId = new Map(doc.layers.map((layer) => [layer.id, layer]));
			const next = [];
			for (const id of order) {
				const layer = byId.get(id);
				if (layer) {
					next.push(layer);
					byId.delete(id);
				}
			}
			for (const layer of byId.values()) next.push(layer);
			return {
				...doc,
				layers: next.map((layer, index) => ({ ...layer, zIndex: index })),
			};
		}
		case EditorCommandType.DUPLICATE: {
			const ids = command.layerIds || [];
			const created = [];
			const offset = Number(command.offset) || 24;
			for (const id of ids) {
				const source = findLayer(doc, id);
				if (!source) continue;
				const copy = {
					...JSON.parse(JSON.stringify(source)),
					id: command.newIds?.[id] || createLayerId(),
					name: `${source.name} copy`,
					x: source.x + offset,
					y: source.y + offset,
					locked: false,
					groupId: null,
					zIndex: doc.layers.length + created.length,
				};
				created.push(copy);
			}
			return {
				...doc,
				layers: [...doc.layers, ...created],
			};
		}
		case EditorCommandType.DELETE: {
			const ids = new Set(command.layerIds || []);
			const layers = doc.layers.filter((layer) => !ids.has(layer.id));
			const groups = (doc.groups || [])
				.map((group) => ({
					...group,
					childIds: (group.childIds || []).filter((id) => !ids.has(id)),
				}))
				.filter((group) => group.childIds.length > 0 || !ids.has(group.id));
			return {
				...doc,
				layers: layers.map((layer, index) => ({ ...layer, zIndex: index })),
				groups,
			};
		}
		case EditorCommandType.LOCK:
		case EditorCommandType.UNLOCK: {
			const ids = new Set(command.layerIds || []);
			const locked = type === EditorCommandType.LOCK;
			return mapLayers(doc, (layer) => (ids.has(layer.id) ? { ...layer, locked } : layer));
		}
		case EditorCommandType.HIDE:
		case EditorCommandType.SHOW: {
			const ids = new Set(command.layerIds || []);
			const visible = type === EditorCommandType.SHOW;
			return mapLayers(doc, (layer) => (ids.has(layer.id) ? { ...layer, visible } : layer));
		}
		case EditorCommandType.RENAME: {
			const id = command.layerId;
			const name = String(command.name || '').trim() || 'Layer';
			return mapLayers(doc, (layer) => (layer.id === id ? { ...layer, name } : layer));
		}
		case EditorCommandType.GROUP: {
			const layerIds = (command.layerIds || []).filter((id) => findLayer(doc, id));
			if (layerIds.length < 2) return doc;
			const groupId = command.groupId || createGroupId();
			const group = {
				id: groupId,
				name: command.name || 'Group',
				childIds: layerIds,
				locked: false,
				visible: true,
			};
			return {
				...doc,
				groups: [...(doc.groups || []).filter((g) => g.id !== groupId), group],
				layers: doc.layers.map((layer) => (
					layerIds.includes(layer.id) ? { ...layer, groupId } : layer
				)),
			};
		}
		case EditorCommandType.UNGROUP: {
			const groupIds = new Set(command.groupIds || []);
			const childIds = new Set();
			for (const group of doc.groups || []) {
				if (groupIds.has(group.id)) {
					for (const id of group.childIds || []) childIds.add(id);
				}
			}
			return {
				...doc,
				groups: (doc.groups || []).filter((group) => !groupIds.has(group.id)),
				layers: doc.layers.map((layer) => (
					childIds.has(layer.id) || groupIds.has(layer.groupId)
						? { ...layer, groupId: null }
						: layer
				)),
			};
		}
		case EditorCommandType.ADD: {
			const layer = command.layer || createLayer(command.layerType || 'text');
			return {
				...doc,
				layers: [...doc.layers, { ...layer, zIndex: doc.layers.length }],
			};
		}
		case EditorCommandType.SET_PROPS: {
			const id = command.layerId;
			const props = command.props && typeof command.props === 'object' ? command.props : {};
			return mapLayers(doc, (layer) => (
				layer.id === id
					? { ...layer, props: { ...layer.props, ...props } }
					: layer
			));
		}
		case EditorCommandType.REPLACE_DOCUMENT: {
			return normalizeEditorDocument(command.document || doc);
		}
		default:
			return doc;
	}
}

/**
 * Build the inverse command for undo. Deterministic given the forward command
 * (and snapshots encoded on the command when needed).
 */
export function invertEditorCommand(command) {
	const type = command?.type;
	switch (type) {
		case EditorCommandType.MOVE:
			return {
				type: EditorCommandType.MOVE,
				layerIds: [...(command.layerIds || [])],
				dx: -(Number(command.dx) || 0),
				dy: -(Number(command.dy) || 0),
			};
		case EditorCommandType.RESIZE:
			return {
				type: EditorCommandType.RESIZE,
				layerIds: [...(command.layerIds || [])],
				patches: command.previousPatches || {},
				previousPatches: command.patches || {},
			};
		case EditorCommandType.ROTATE:
			if (command.previousRotationById) {
				return {
					type: EditorCommandType.ROTATE,
					layerIds: [...(command.layerIds || [])],
					rotationById: command.previousRotationById,
					previousRotationById: command.rotationById || {},
				};
			}
			return {
				type: EditorCommandType.ROTATE,
				layerIds: [...(command.layerIds || [])],
				delta: -(Number(command.delta) || 0),
			};
		case EditorCommandType.REORDER:
			return {
				type: EditorCommandType.REORDER,
				order: [...(command.previousOrder || [])],
				previousOrder: [...(command.order || [])],
			};
		case EditorCommandType.DUPLICATE:
			return {
				type: EditorCommandType.DELETE,
				layerIds: Object.values(command.newIds || {}),
				_restoredLayers: undefined,
			};
		case EditorCommandType.DELETE:
			return {
				type: EditorCommandType.REPLACE_DOCUMENT,
				document: command.documentBefore,
			};
		case EditorCommandType.LOCK:
			return { type: EditorCommandType.UNLOCK, layerIds: [...(command.layerIds || [])] };
		case EditorCommandType.UNLOCK:
			return { type: EditorCommandType.LOCK, layerIds: [...(command.layerIds || [])] };
		case EditorCommandType.HIDE:
			return { type: EditorCommandType.SHOW, layerIds: [...(command.layerIds || [])] };
		case EditorCommandType.SHOW:
			return { type: EditorCommandType.HIDE, layerIds: [...(command.layerIds || [])] };
		case EditorCommandType.RENAME:
			return {
				type: EditorCommandType.RENAME,
				layerId: command.layerId,
				name: command.previousName,
				previousName: command.name,
			};
		case EditorCommandType.GROUP:
			return {
				type: EditorCommandType.UNGROUP,
				groupIds: [command.groupId],
			};
		case EditorCommandType.UNGROUP:
			return {
				type: EditorCommandType.REPLACE_DOCUMENT,
				document: command.documentBefore,
			};
		case EditorCommandType.ADD:
			return {
				type: EditorCommandType.DELETE,
				layerIds: [command.layer?.id].filter(Boolean),
			};
		case EditorCommandType.SET_PROPS:
			return {
				type: EditorCommandType.SET_PROPS,
				layerId: command.layerId,
				props: command.previousProps || {},
				previousProps: command.props || {},
			};
		case EditorCommandType.REPLACE_DOCUMENT:
			return {
				type: EditorCommandType.REPLACE_DOCUMENT,
				document: command.previousDocument,
				previousDocument: command.document,
			};
		default:
			return null;
	}
}

/** Enrich commands that need snapshots for invertibility. */
export function prepareCommand(document, command) {
	const type = command?.type;
	if (type === EditorCommandType.DELETE) {
		return {
			...command,
			documentBefore: cloneDoc(document),
		};
	}
	if (type === EditorCommandType.UNGROUP) {
		return {
			...command,
			documentBefore: cloneDoc(document),
		};
	}
	if (type === EditorCommandType.RESIZE) {
		const previousPatches = {};
		for (const id of command.layerIds || []) {
			const layer = findLayer(document, id);
			if (!layer) continue;
			previousPatches[id] = {
				x: layer.x,
				y: layer.y,
				width: layer.width,
				height: layer.height,
			};
		}
		return { ...command, previousPatches };
	}
	if (type === EditorCommandType.ROTATE && command.rotationById) {
		const previousRotationById = {};
		for (const id of command.layerIds || []) {
			const layer = findLayer(document, id);
			if (layer) previousRotationById[id] = layer.rotation;
		}
		return { ...command, previousRotationById };
	}
	if (type === EditorCommandType.REORDER) {
		return {
			...command,
			previousOrder: document.layers.map((layer) => layer.id),
		};
	}
	if (type === EditorCommandType.RENAME) {
		const layer = findLayer(document, command.layerId);
		return {
			...command,
			previousName: layer?.name || '',
		};
	}
	if (type === EditorCommandType.SET_PROPS) {
		const layer = findLayer(document, command.layerId);
		const previousProps = {};
		for (const key of Object.keys(command.props || {})) {
			previousProps[key] = layer?.props?.[key];
		}
		return { ...command, previousProps };
	}
	if (type === EditorCommandType.DUPLICATE) {
		const newIds = { ...(command.newIds || {}) };
		for (const id of command.layerIds || []) {
			if (!newIds[id]) newIds[id] = createLayerId();
		}
		return { ...command, newIds };
	}
	if (type === EditorCommandType.GROUP) {
		return {
			...command,
			groupId: command.groupId || createGroupId(),
		};
	}
	if (type === EditorCommandType.REPLACE_DOCUMENT) {
		return {
			...command,
			previousDocument: cloneDoc(document),
		};
	}
	if (type === EditorCommandType.ADD && !command.layer) {
		return {
			...command,
			layer: createLayer(command.layerType || 'text', command.layerDefaults || {}),
		};
	}
	return command;
}

export function createMoveCommand(layerIds, dx, dy) {
	return { type: EditorCommandType.MOVE, layerIds: [...layerIds], dx, dy };
}

export function createResizeCommand(layerIds, patches) {
	return { type: EditorCommandType.RESIZE, layerIds: [...layerIds], patches };
}

export function createRotateCommand(layerIds, rotationById) {
	return { type: EditorCommandType.ROTATE, layerIds: [...layerIds], rotationById };
}

export function createReorderCommand(order) {
	return { type: EditorCommandType.REORDER, order: [...order] };
}

export function createDuplicateCommand(layerIds) {
	return { type: EditorCommandType.DUPLICATE, layerIds: [...layerIds] };
}

export function createDeleteCommand(layerIds) {
	return { type: EditorCommandType.DELETE, layerIds: [...layerIds] };
}

export function createLockCommand(layerIds, locked = true) {
	return {
		type: locked ? EditorCommandType.LOCK : EditorCommandType.UNLOCK,
		layerIds: [...layerIds],
	};
}

export function createVisibilityCommand(layerIds, visible = true) {
	return {
		type: visible ? EditorCommandType.SHOW : EditorCommandType.HIDE,
		layerIds: [...layerIds],
	};
}

export function createRenameCommand(layerId, name) {
	return { type: EditorCommandType.RENAME, layerId, name };
}

export function createGroupCommand(layerIds, name = 'Group') {
	return { type: EditorCommandType.GROUP, layerIds: [...layerIds], name };
}

export function createUngroupCommand(groupIds) {
	return { type: EditorCommandType.UNGROUP, groupIds: [...groupIds] };
}

export function createAddLayerCommand(layerType, layerDefaults = {}) {
	return { type: EditorCommandType.ADD, layerType, layerDefaults };
}

export function createSetPropsCommand(layerId, props) {
	return { type: EditorCommandType.SET_PROPS, layerId, props };
}
