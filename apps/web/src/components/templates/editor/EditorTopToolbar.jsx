import { ArrowLeft, Eye, Redo2, Undo2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
	setEditorName,
	setEditorUi,
	getEditorState,
} from '@/services/templates';
import { previewEditorDocument, revokePreviewObjectUrl } from '@/services/templates/editorPreview';
import { useEditorActions, useEditorStore } from '@/services/templates/useEditorStore';
import { useToast } from '@/hooks/use-toast';

export default function EditorTopToolbar({ onManualSave, saving }) {
	const name = useEditorStore((s) => s.name);
	const dirty = useEditorStore((s) => s.dirty);
	const autosave = useEditorStore((s) => s.autosave);
	const document = useEditorStore((s) => s.document);
	const previewBusy = useEditorStore((s) => s.ui.previewBusy);
	const canUndo = useEditorStore((s) => s.history.past.length > 0);
	const canRedo = useEditorStore((s) => s.history.future.length > 0);
	const actions = useEditorActions();
	const { toast } = useToast();

	async function handlePreview() {
		setEditorUi({ previewBusy: true, previewError: '' });
		try {
			const previousUrl = getEditorState().ui.previewUrl;
			const result = await previewEditorDocument(document);
			if (previousUrl && previousUrl !== result.objectUrl) {
				revokePreviewObjectUrl(previousUrl);
			}
			setEditorUi({ previewUrl: result.objectUrl, previewBusy: false });
		} catch (error) {
			setEditorUi({ previewBusy: false, previewError: error?.message || 'Preview failed' });
			toast({
				title: 'Preview failed',
				description: error?.message || 'Could not render preview',
				variant: 'destructive',
			});
		}
	}

	const autosaveLabel = autosave.status === 'saving'
		? 'Saving…'
		: autosave.status === 'error'
			? 'Save error'
			: dirty
				? 'Unsaved changes'
				: 'Saved';

	return (
		<header className="tpl-editor-top">
			<div className="tpl-editor-top__left">
				<Link to="/app/ai-pins/templates" className="tpl-editor-back" aria-label="Back to templates">
					<ArrowLeft size={16} aria-hidden="true" /> Templates
				</Link>
				<input
					className="tpl-editor-name"
					value={name}
					onChange={(event) => setEditorName(event.target.value)}
					aria-label="Template name"
				/>
				<span className="tpl-editor-pill" aria-live="polite">{dirty ? 'Unsaved' : 'Saved'}</span>
				<span className="tpl-editor-pill tpl-editor-pill--muted" aria-live="polite">{autosaveLabel}</span>
			</div>
			<div className="tpl-editor-top__right">
				<button type="button" disabled={!canUndo} onClick={() => actions.undo()} aria-label="Undo" title="Undo">
					<Undo2 size={16} aria-hidden="true" />
				</button>
				<button type="button" disabled={!canRedo} onClick={() => actions.redo()} aria-label="Redo" title="Redo">
					<Redo2 size={16} aria-hidden="true" />
				</button>
				<button
					type="button"
					onClick={handlePreview}
					disabled={previewBusy}
					aria-label="Preview template"
					title="Preview via compositor"
				>
					<Eye size={16} aria-hidden="true" /> {previewBusy ? 'Rendering…' : 'Preview'}
				</button>
				<button
					type="button"
					className="tpl-editor-save"
					disabled={saving}
					onClick={() => onManualSave?.()}
					aria-busy={saving ? 'true' : 'false'}
				>
					{saving ? 'Saving…' : 'Save'}
				</button>
			</div>
		</header>
	);
}
