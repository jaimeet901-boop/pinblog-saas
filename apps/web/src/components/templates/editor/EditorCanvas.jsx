import { useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import {
	createMoveCommand,
	createResizeCommand,
	createRotateCommand,
	dispatchEditorCommand,
	selectLayers,
	setEditorSelection,
	setEditorUi,
} from '@/services/templates';
import { useEditorStore } from '@/services/templates/useEditorStore';
import KonvaLayerNode from './konva/KonvaLayerNode';
import SelectionTransformer from './konva/SelectionTransformer';

function rectsIntersect(a, b) {
	return !(
		a.x + a.width < b.x
		|| b.x + b.width < a.x
		|| a.y + a.height < b.y
		|| b.y + b.height < a.y
	);
}

/**
 * Interactive canvas — edits document model only; pixel preview uses compositor separately.
 * Performance: only `visible` layers are mounted.
 */
export default function EditorCanvas() {
	const document = useEditorStore((s) => s.document);
	const selection = useEditorStore((s) => s.selection);
	const zoom = useEditorStore((s) => s.ui.zoom);
	const stageRef = useRef(null);
	const [marquee, setMarquee] = useState(null);
	const dragOrigins = useRef(new Map());

	const width = document.canvas.width;
	const height = document.canvas.height;

	const visibleLayers = useMemo(
		() => document.layers.filter((layer) => layer.visible !== false),
		[document.layers],
	);

	const selectedSet = useMemo(() => new Set(selection.layerIds), [selection.layerIds]);
	const lockedIds = useMemo(() => {
		const set = new Set();
		for (const layer of document.layers) {
			if (layer.locked) set.add(layer.id);
		}
		return set;
	}, [document.layers]);

	function pointerToCanvas(stage) {
		const pointer = stage.getPointerPosition();
		if (!pointer) return null;
		const transform = stage.getAbsoluteTransform().copy().invert();
		return transform.point(pointer);
	}

	function handleSelect(layerId, event) {
		const additive = event?.evt?.shiftKey || event?.evt?.ctrlKey || event?.evt?.metaKey;
		selectLayers([layerId], { additive, groupAware: true });
	}

	function handleDragEnd(layerId, next) {
		const layer = document.layers.find((item) => item.id === layerId);
		if (!layer) return;
		const ids = selectedSet.has(layerId) ? selection.layerIds : [layerId];
		const origin = dragOrigins.current.get(layerId);
		const dx = next.x - (origin?.x ?? layer.x);
		const dy = next.y - (origin?.y ?? layer.y);
		dragOrigins.current.delete(layerId);
		if (!dx && !dy) return;
		dispatchEditorCommand(createMoveCommand(ids, dx, dy));
	}

	function handleTransformEnd(layerId, next) {
		dispatchEditorCommand(createResizeCommand([layerId], {
			[layerId]: {
				x: next.x,
				y: next.y,
				width: next.width,
				height: next.height,
			},
		}));
		if (Number.isFinite(next.rotation)) {
			dispatchEditorCommand(createRotateCommand([layerId], { [layerId]: next.rotation }));
		}
	}

	return (
		<div className="tpl-editor-canvas-wrap">
			<div className="tpl-editor-canvas-zoom">
				<button type="button" onClick={() => setEditorUi({ zoom: Math.max(0.2, zoom - 0.05) })}>−</button>
				<span>{Math.round(zoom * 100)}%</span>
				<button type="button" onClick={() => setEditorUi({ zoom: Math.min(1.5, zoom + 0.05) })}>+</button>
			</div>
			<Stage
				ref={stageRef}
				width={Math.round(width * zoom)}
				height={Math.round(height * zoom)}
				scaleX={zoom}
				scaleY={zoom}
				className="tpl-editor-stage"
				onMouseDown={(event) => {
					if (event.target !== event.target.getStage()) return;
					const stage = event.target.getStage();
					const point = pointerToCanvas(stage);
					if (!point) return;
					setMarquee({ x: point.x, y: point.y, width: 0, height: 0 });
					if (!event.evt.shiftKey) {
						setEditorSelection({ layerIds: [], groupIds: [], marquee: null });
					}
				}}
				onMouseMove={(event) => {
					if (!marquee) return;
					const stage = event.target.getStage();
					const point = pointerToCanvas(stage);
					if (!point) return;
					setMarquee({
						x: Math.min(marquee.x, point.x),
						y: Math.min(marquee.y, point.y),
						width: Math.abs(point.x - marquee.x),
						height: Math.abs(point.y - marquee.y),
					});
				}}
				onMouseUp={() => {
					if (!marquee) return;
					if (marquee.width > 4 && marquee.height > 4) {
						const hits = visibleLayers
							.filter((layer) => rectsIntersect(marquee, {
								x: layer.x,
								y: layer.y,
								width: layer.width,
								height: layer.height,
							}))
							.map((layer) => layer.id);
						selectLayers(hits, { additive: false, groupAware: true });
					}
					setMarquee(null);
				}}
			>
				<Layer>
					<Rect width={width} height={height} fill="#1c1917" listening={false} />
					{visibleLayers.map((layer) => (
						<KonvaLayerNode
							key={layer.id}
							layer={layer}
							selected={selectedSet.has(layer.id)}
							onSelect={handleSelect}
							onDragStart={(id, pos) => {
								dragOrigins.current.set(id, pos);
							}}
							onDragEnd={handleDragEnd}
							onTransformEnd={handleTransformEnd}
						/>
					))}
					{marquee ? (
						<Rect
							x={marquee.x}
							y={marquee.y}
							width={marquee.width}
							height={marquee.height}
							fill="rgba(37,99,235,0.12)"
							stroke="rgba(37,99,235,0.8)"
							dash={[4, 4]}
							listening={false}
						/>
					) : null}
					<SelectionTransformer
						selectedIds={selection.layerIds}
						lockedIds={lockedIds}
						stageRef={stageRef}
					/>
				</Layer>
			</Stage>
		</div>
	);
}
