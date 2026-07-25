import { listCreatableLayerTypes } from '@/services/templates';
import { useEditorActions } from '@/services/templates/useEditorStore';

const LABELS = {
	background: 'Background',
	image: 'Image',
	aiImage: 'AI Image',
	text: 'Text',
	shape: 'Shape',
	badge: 'Badge',
	cta: 'CTA',
	sticker: 'Sticker',
	logo: 'Logo',
	divider: 'Divider',
	gradient: 'Gradient',
};

export default function ElementsPanel() {
	const actions = useEditorActions();
	const types = listCreatableLayerTypes();

	return (
		<div className="tpl-editor-panel">
			<div className="tpl-editor-panel__head">
				<h3>Elements</h3>
			</div>
			<div className="tpl-editor-elements">
				{types.map((type) => (
					<button
						key={type}
						type="button"
						className="tpl-editor-elements__item"
						onClick={() => actions.addLayer(type)}
					>
						{LABELS[type] || type}
					</button>
				))}
			</div>
			<p className="tpl-editor-hint">Adds a layer via typed ADD command (undoable).</p>
		</div>
	);
}
