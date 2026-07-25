/**
 * Reserved extension panels — intentional slots, not Module stubs.
 * Real asset libraries / version UI can plug in without shell rewrites.
 */
export function UploadsPanel() {
	return (
		<div className="tpl-editor-panel" role="region" aria-label="Uploads">
			<div className="tpl-editor-panel__head"><h3>Uploads</h3></div>
			<p className="tpl-editor-hint">
				Upload library is not enabled yet. Add image layers from Elements, or paste image URLs in layer properties.
			</p>
		</div>
	);
}

export function BackgroundsPanel() {
	return (
		<div className="tpl-editor-panel" role="region" aria-label="Backgrounds">
			<div className="tpl-editor-panel__head"><h3>Backgrounds</h3></div>
			<p className="tpl-editor-hint">
				Use Elements → Background to add a full-canvas background layer.
			</p>
		</div>
	);
}

export function VersionHistoryPanel() {
	return (
		<div className="tpl-editor-panel" role="region" aria-label="Version history">
			<div className="tpl-editor-panel__head"><h3>Versions</h3></div>
			<p className="tpl-editor-hint">
				Template revisions are stored on save (`revision` + checksum). A timeline UI will use that data later.
			</p>
		</div>
	);
}
