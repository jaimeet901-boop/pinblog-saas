import { memo, useMemo } from 'react';
import { Rect, Text, Image as KonvaImage, Group, Ellipse } from 'react-konva';
import useImage from './useHtmlImage';

function LayerVisual({ layer }) {
	const { type, width, height, props = {} } = layer;
	const imageUrl = props.src || props.imageSrc || '';
	const [image] = useImage(type === 'text' || type === 'shape' || type === 'divider' || type === 'gradient' || type === 'badge' || type === 'cta' ? '' : imageUrl);

	if (type === 'background') {
		return (
			<>
				<Rect width={width} height={height} fill={props.color || '#111'} listening={false} />
				{image ? <KonvaImage image={image} width={width} height={height} listening={false} /> : null}
			</>
		);
	}

	if (type === 'image' || type === 'aiImage' || type === 'sticker' || type === 'logo') {
		if (image) {
			return <KonvaImage image={image} width={width} height={height} listening={false} />;
		}
		return <Rect width={width} height={height} fill="rgba(255,255,255,0.08)" listening={false} />;
	}

	if (type === 'text') {
		return (
			<Text
				text={String(props.text || '')}
				width={width}
				height={height}
				fontSize={props.fontSize || 48}
				fontFamily={props.fontFamily || 'Georgia, serif'}
				fontStyle={String(props.fontWeight || 700)}
				fill={props.color || '#fff'}
				align={props.align || 'left'}
				listening={false}
			/>
		);
	}

	if (type === 'shape') {
		if (props.shape === 'ellipse') {
			return (
				<Ellipse
					x={width / 2}
					y={height / 2}
					radiusX={width / 2}
					radiusY={height / 2}
					fill={props.fill || '#fff'}
					stroke={props.stroke || undefined}
					strokeWidth={props.strokeWidth || 0}
					listening={false}
				/>
			);
		}
		return (
			<Rect
				width={width}
				height={height}
				fill={props.fill || '#fff'}
				stroke={props.stroke || undefined}
				strokeWidth={props.strokeWidth || 0}
				cornerRadius={layer.borderRadius || 0}
				listening={false}
			/>
		);
	}

	if (type === 'badge' || type === 'cta') {
		return (
			<>
				<Rect width={width} height={height} fill={props.fill || '#fff'} cornerRadius={999} listening={false} />
				<Text
					text={String(props.text || '')}
					width={width}
					height={height}
					align="center"
					verticalAlign="middle"
					fontSize={props.fontSize || 28}
					fill={props.textColor || '#111'}
					listening={false}
				/>
			</>
		);
	}

	if (type === 'divider') {
		const t = props.thickness || 2;
		return (
			<Rect
				y={(height - t) / 2}
				width={width}
				height={t}
				fill={props.color || '#fff'}
				listening={false}
			/>
		);
	}

	if (type === 'gradient') {
		return (
			<Rect
				width={width}
				height={height}
				fillLinearGradientStartPoint={{ x: 0, y: 0 }}
				fillLinearGradientEndPoint={{ x: 0, y: height }}
				fillLinearGradientColorStops={[0, props.colors?.[0] || 'rgba(0,0,0,0)', 1, props.colors?.[1] || 'rgba(0,0,0,0.75)']}
				listening={false}
			/>
		);
	}

	return <Rect width={width} height={height} stroke="#666" dash={[6, 4]} listening={false} />;
}

function KonvaLayerNodeInner({
	layer,
	selected,
	onSelect,
	onDragStart,
	onDragEnd,
	onTransformEnd,
}) {
	const listening = layer.visible !== false;

	const common = useMemo(() => ({
		id: layer.id,
		name: layer.id,
		x: layer.x,
		y: layer.y,
		width: layer.width,
		height: layer.height,
		rotation: layer.rotation || 0,
		opacity: layer.opacity ?? 1,
		draggable: !layer.locked && listening,
		visible: layer.visible !== false,
		listening,
	}), [layer, listening]);

	if (layer.visible === false) {
		return null;
	}

	return (
		<Group
			{...common}
			onClick={(event) => {
				event.cancelBubble = true;
				onSelect?.(layer.id, event);
			}}
			onTap={(event) => {
				event.cancelBubble = true;
				onSelect?.(layer.id, event);
			}}
			onDragStart={(event) => {
				onDragStart?.(layer.id, {
					x: event.target.x(),
					y: event.target.y(),
				});
			}}
			onDragEnd={(event) => {
				onDragEnd?.(layer.id, {
					x: event.target.x(),
					y: event.target.y(),
				});
			}}
			onTransformEnd={(event) => {
				const node = event.target;
				const scaleX = node.scaleX();
				const scaleY = node.scaleY();
				node.scaleX(1);
				node.scaleY(1);
				onTransformEnd?.(layer.id, {
					x: node.x(),
					y: node.y(),
					width: Math.max(1, node.width() * scaleX),
					height: Math.max(1, node.height() * scaleY),
					rotation: node.rotation(),
				});
			}}
		>
			<LayerVisual layer={layer} />
			{selected ? (
				<Rect
					width={layer.width}
					height={layer.height}
					stroke="rgba(37, 99, 235, 0.9)"
					strokeWidth={2}
					listening={false}
				/>
			) : null}
		</Group>
	);
}

const KonvaLayerNode = memo(KonvaLayerNodeInner);
export default KonvaLayerNode;
