import { useEffect, useRef } from 'react';
import { Transformer } from 'react-konva';

/**
 * Attaches Konva Transformer to selected layer nodes (unlocked only).
 */
export default function SelectionTransformer({ selectedIds, stageRef, lockedIds }) {
	const transformerRef = useRef(null);

	useEffect(() => {
		const transformer = transformerRef.current;
		const stage = stageRef.current;
		if (!transformer || !stage) return;

		const nodes = selectedIds
			.filter((id) => !lockedIds.has(id))
			.map((id) => stage.findOne(`#${CSS.escape ? CSS.escape(id) : id}`))
			.filter(Boolean);

		transformer.nodes(nodes);
		transformer.getLayer()?.batchDraw();
	}, [selectedIds, lockedIds, stageRef]);

	return (
		<Transformer
			ref={transformerRef}
			rotateEnabled
			enabledAnchors={[
				'top-left', 'top-right', 'bottom-left', 'bottom-right',
				'middle-left', 'middle-right', 'top-center', 'bottom-center',
			]}
			boundBoxFunc={(oldBox, newBox) => {
				if (newBox.width < 8 || newBox.height < 8) return oldBox;
				return newBox;
			}}
		/>
	);
}
