import { useEffect, useMemo } from 'react';
import {
	createEditorShortcutManager,
} from '@/services/templates';
import { useEditorActions } from '@/services/templates/useEditorStore';
import EditorCanvas from './EditorCanvas';
import EditorLeftSidebar from './EditorLeftSidebar';
import EditorRightSidebar from './EditorRightSidebar';
import EditorTopToolbar from './EditorTopToolbar';

export default function TemplateEditorShell({ onManualSave, saving }) {
	const actions = useEditorActions();
	const shortcuts = useMemo(() => createEditorShortcutManager(), []);

	useEffect(() => {
		function onKeyDown(event) {
			shortcuts.handleKeyDown(event, actions);
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [actions, shortcuts]);

	return (
		<div className="tpl-editor-shell">
			<EditorTopToolbar onManualSave={onManualSave} saving={saving} />
			<div className="tpl-editor-body">
				<EditorLeftSidebar />
				<main className="tpl-editor-main">
					<EditorCanvas />
				</main>
				<EditorRightSidebar />
			</div>
		</div>
	);
}
