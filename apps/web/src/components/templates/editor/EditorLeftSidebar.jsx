import { setEditorUi } from '@/services/templates';
import { useEditorStore } from '@/services/templates/useEditorStore';
import ElementsPanel from './ElementsPanel';
import LayersPanel from './LayersPanel';
import { BackgroundsPanel, UploadsPanel, VersionHistoryPanel } from './ReservedPanels';

const TABS = [
	{ id: 'layers', label: 'Layers' },
	{ id: 'elements', label: 'Elements' },
	{ id: 'uploads', label: 'Uploads' },
	{ id: 'backgrounds', label: 'Backgrounds' },
	{ id: 'versions', label: 'Versions' },
];

export default function EditorLeftSidebar() {
	const leftPanel = useEditorStore((s) => s.ui.leftPanel);

	return (
		<aside className="tpl-editor-left" aria-label="Editor tools">
			<div className="tpl-editor-tabs" role="tablist" aria-label="Editor panels">
				{TABS.map((tab) => {
					const selected = leftPanel === tab.id;
					return (
						<button
							key={tab.id}
							type="button"
							role="tab"
							id={`tpl-tab-${tab.id}`}
							aria-selected={selected}
							aria-controls={`tpl-panel-${tab.id}`}
							tabIndex={selected ? 0 : -1}
							className={selected ? 'is-active' : ''}
							onClick={() => setEditorUi({ leftPanel: tab.id })}
						>
							{tab.label}
						</button>
					);
				})}
			</div>
			<div
				id={`tpl-panel-${leftPanel}`}
				role="tabpanel"
				aria-labelledby={`tpl-tab-${leftPanel}`}
			>
				{leftPanel === 'layers' ? <LayersPanel /> : null}
				{leftPanel === 'elements' ? <ElementsPanel /> : null}
				{leftPanel === 'uploads' ? <UploadsPanel /> : null}
				{leftPanel === 'backgrounds' ? <BackgroundsPanel /> : null}
				{leftPanel === 'versions' ? <VersionHistoryPanel /> : null}
			</div>
		</aside>
	);
}
