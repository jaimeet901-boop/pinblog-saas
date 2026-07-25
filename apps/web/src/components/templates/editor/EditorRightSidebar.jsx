import { EDITOR_EXTENSION_IDS, setExtensionEnabled } from '@/services/templates';
import { useEditorStore } from '@/services/templates/useEditorStore';
import LayerPropertiesPanel from './LayerPropertiesPanel';

export default function EditorRightSidebar() {
	const extensions = useEditorStore((s) => s.extensions);
	const previewUrl = useEditorStore((s) => s.ui.previewUrl);
	const previewBusy = useEditorStore((s) => s.ui.previewBusy);

	return (
		<aside className="tpl-editor-right">
			<LayerPropertiesPanel />
			<div className="tpl-editor-panel">
				<div className="tpl-editor-panel__head"><h3>Extensions</h3></div>
				<p className="tpl-editor-hint">Optional feature flags for future panels (uploads, guides, etc.).</p>
				<ul className="tpl-editor-extensions">
					{EDITOR_EXTENSION_IDS.map((id) => (
						<li key={id}>
							<label>
								<input
									type="checkbox"
									checked={Boolean(extensions[id]?.enabled)}
									onChange={(event) => setExtensionEnabled(id, event.target.checked)}
								/>
								{id}
							</label>
						</li>
					))}
				</ul>
			</div>
			<div className="tpl-editor-panel">
				<div className="tpl-editor-panel__head"><h3>Compositor preview</h3></div>
				{previewBusy ? <p className="tpl-editor-hint">Rendering…</p> : null}
				{previewUrl ? (
					<img src={previewUrl} alt="Template preview" className="tpl-editor-preview" />
				) : (
					<p className="tpl-editor-hint">Preview runs through pinLayerCompositor (PNG).</p>
				)}
			</div>
		</aside>
	);
}
