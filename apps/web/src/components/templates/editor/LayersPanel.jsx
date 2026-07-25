import {
	Copy, Eye, EyeOff, Group as GroupIcon, Lock, Trash2, Unlock,
} from 'lucide-react';
import { useEditorActions, useEditorStore } from '@/services/templates/useEditorStore';

export default function LayersPanel() {
	const layers = useEditorStore((s) => s.document.layers);
	const selection = useEditorStore((s) => s.selection);
	const actions = useEditorActions();
	const ordered = [...layers].sort((a, b) => b.zIndex - a.zIndex);

	return (
		<div className="tpl-editor-panel">
			<div className="tpl-editor-panel__head">
				<h3>Layers</h3>
				<div className="tpl-editor-panel__actions">
					<button type="button" title="Duplicate" onClick={() => actions.duplicateSelection()}><Copy size={14} /></button>
					<button type="button" title="Group" onClick={() => actions.groupSelection()}><GroupIcon size={14} /></button>
					<button type="button" title="Delete" onClick={() => actions.deleteSelection()}><Trash2 size={14} /></button>
				</div>
			</div>
			<ul className="tpl-editor-layers">
				{ordered.map((layer, index) => {
					const selected = selection.layerIds.includes(layer.id);
					return (
						<li key={layer.id} className={selected ? 'is-selected' : ''}>
							<button
								type="button"
								className="tpl-editor-layers__select"
								onClick={(event) => {
									actions.selectLayers([layer.id], {
										additive: event.shiftKey || event.metaKey || event.ctrlKey,
										groupAware: true,
									});
								}}
							>
								<span className="tpl-editor-layers__type">{layer.type}</span>
								<span className="tpl-editor-layers__name">{layer.name}</span>
							</button>
							<div className="tpl-editor-layers__ops">
								<button
									type="button"
									title={layer.visible === false ? 'Show' : 'Hide'}
									onClick={() => {
										actions.selectLayers([layer.id], { groupAware: false });
										if (layer.visible === false) actions.showSelection();
										else actions.hideSelection();
									}}
								>
									{layer.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
								</button>
								<button
									type="button"
									title={layer.locked ? 'Unlock' : 'Lock'}
									onClick={() => {
										actions.selectLayers([layer.id], { groupAware: false });
										if (layer.locked) actions.unlockSelection();
										else actions.lockSelection();
									}}
								>
									{layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
								</button>
								<button
									type="button"
									title="Move up"
									onClick={() => {
										const ids = ordered.map((item) => item.id);
										if (index <= 0) return;
										const next = [...ids];
										[next[index - 1], next[index]] = [next[index], next[index - 1]];
										actions.reorder([...next].reverse());
									}}
								>
									↑
								</button>
								<button
									type="button"
									title="Move down"
									onClick={() => {
										const ids = ordered.map((item) => item.id);
										if (index >= ids.length - 1) return;
										const next = [...ids];
										[next[index + 1], next[index]] = [next[index], next[index + 1]];
										actions.reorder([...next].reverse());
									}}
								>
									↓
								</button>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
