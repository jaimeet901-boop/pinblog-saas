import { useEditorActions, useEditorStore } from '@/services/templates/useEditorStore';

export default function LayerPropertiesPanel() {
	const selected = useEditorStore((s) => {
		const ids = new Set(s.selection.layerIds);
		return s.document.layers.filter((layer) => ids.has(layer.id));
	});
	const actions = useEditorActions();
	const layer = selected[0] || null;

	if (!layer) {
		return (
			<div className="tpl-editor-panel">
				<div className="tpl-editor-panel__head"><h3>Properties</h3></div>
				<p className="tpl-editor-hint">Select a layer to edit properties via commands.</p>
			</div>
		);
	}

	const multi = selected.length > 1;

	return (
		<div className="tpl-editor-panel">
			<div className="tpl-editor-panel__head">
				<h3>Properties</h3>
			</div>
			{multi ? (
				<p className="tpl-editor-hint">{selected.length} layers selected</p>
			) : null}
			<label className="tpl-editor-field">
				<span>Name</span>
				<input
					value={layer.name}
					disabled={multi}
					onChange={(event) => actions.rename(layer.id, event.target.value)}
				/>
			</label>
			<label className="tpl-editor-field">
				<span>Type</span>
				<input value={layer.type} disabled />
			</label>
			{(layer.type === 'text' || layer.type === 'cta' || layer.type === 'badge') ? (
				<label className="tpl-editor-field">
					<span>Text</span>
					<textarea
						rows={3}
						value={String(layer.props?.text || '')}
						disabled={multi}
						onChange={(event) => actions.setProps(layer.id, { text: event.target.value })}
					/>
				</label>
			) : null}
			{(layer.type === 'background' || layer.type === 'shape') ? (
				<label className="tpl-editor-field">
					<span>Fill</span>
					<input
						value={String(layer.props?.color || layer.props?.fill || '#ffffff')}
						disabled={multi}
						onChange={(event) => {
							if (layer.type === 'background') {
								actions.setProps(layer.id, { color: event.target.value });
							} else {
								actions.setProps(layer.id, { fill: event.target.value });
							}
						}}
					/>
				</label>
			) : null}
			<div className="tpl-editor-field-row">
				<label className="tpl-editor-field">
					<span>X</span>
					<input value={Math.round(layer.x)} disabled readOnly />
				</label>
				<label className="tpl-editor-field">
					<span>Y</span>
					<input value={Math.round(layer.y)} disabled readOnly />
				</label>
			</div>
			<p className="tpl-editor-hint">Move/resize/rotate via canvas commands. Raw JSON is never edited.</p>
		</div>
	);
}
