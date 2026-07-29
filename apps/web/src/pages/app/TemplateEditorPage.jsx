import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import apiServerClient from '@/lib/apiServerClient';
import { createTemplateThumbnail } from '@/lib/pinTemplates';
import { createTemplateUuid, hashTemplateConfiguration, nextRevision } from '@/lib/pinTemplateIdentity';
import {
	bindEditorAutosave,
	getEditorState,
	loadEditorSession,
	markEditorSaved,
	resetEditorStore,
} from '@/services/templates';
import TemplateEditorShell from '@/components/templates/editor/TemplateEditorShell';
import UpgradeModal from '@/components/billing/UpgradeModal';
import { getTemplateAccess, isTemplateAccessLocked } from '@/lib/templateAccess';
import {
	PRODUCT_EVENTS,
	buildTemplateEventProps,
	trackProductEvent,
} from '@/lib/productAnalytics';
import { useToast } from '@/hooks/use-toast';
import { Spinner } from '@/components/kit';
import './TemplateEditorPage.css';

function mapRecord(record) {
	return {
		id: record.id,
		templateUuid: record.template_uuid || record.templateUuid || null,
		name: record.name || 'Untitled template',
		revision: record.revision || 1,
		configuration: record.configuration || {},
		access: record.access || null,
	};
}

export default function TemplateEditorPage() {
	const { id } = useParams();
	const navigate = useNavigate();
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [upgradePayload, setUpgradePayload] = useState(null);
	const [upgradeOpen, setUpgradeOpen] = useState(false);
	const saveRef = useRef(null);

	useEffect(() => {
		let cancelled = false;

		async function boot() {
			setLoading(true);
			setError('');
			setUpgradePayload(null);
			setUpgradeOpen(false);
			try {
				if (!id || id === 'new') {
					loadEditorSession({
						templateId: null,
						name: 'New layer template',
						configuration: null,
					});
					return;
				}
				const response = await apiServerClient.fetch(`/workspace/v1/templates/${id}`, { method: 'GET' });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(payload.message || 'Failed to load template');
				}
				const record = mapRecord(payload.item || payload);
				if (cancelled) return;
				if (isTemplateAccessLocked(record)) {
					const next = {
						templateId: record.id,
						templateName: record.name,
						access: getTemplateAccess(record),
						sourcePage: 'template_editor',
					};
					trackProductEvent(
						PRODUCT_EVENTS.TEMPLATE_LOCKED_CLICK,
						buildTemplateEventProps(record, { sourcePage: 'template_editor' }),
						{ dedupeKey: `template_locked_click:template_editor:${record.id}` },
					);
					setUpgradePayload(next);
					setUpgradeOpen(true);
					setError('This template requires a plan upgrade to edit.');
					return;
				}
				loadEditorSession({
					templateId: record.id,
					templateUuid: record.templateUuid,
					name: record.name,
					revision: record.revision,
					configuration: record.configuration,
				});
			} catch (err) {
				if (!cancelled) {
					setError(err.message || 'Failed to open editor');
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		boot();
		return () => {
			cancelled = true;
			resetEditorStore();
		};
	}, [id]);

	async function handleManualSave({ silent = false } = {}) {
		const state = getEditorState();
		setSaving(true);
		try {
			const checksum = await hashTemplateConfiguration(state.document);
			const templateUuid = state.templateUuid || createTemplateUuid();
			const body = {
				name: state.name,
				configuration: state.document,
				thumbnail: createTemplateThumbnail(state.document),
				template_uuid: templateUuid,
				config_checksum: checksum,
				revision: nextRevision(state.revision),
				editor_version: 2,
				schema_version: state.document.schemaVersion,
			};

			let response;
			if (state.templateId) {
				response = await apiServerClient.fetch(`/workspace/v1/templates/${state.templateId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				});
			} else {
				response = await apiServerClient.fetch('/workspace/v1/templates', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ...body, isDefault: false }),
				});
			}

			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload.message || 'Save failed');
			}

			const saved = payload.item || payload;
			markEditorSaved({
				checksum,
				revision: saved.revision || body.revision,
			});

			if (!state.templateId && saved.id) {
				navigate(`/app/ai-pins/templates/${saved.id}/edit`, { replace: true });
			}

			if (!silent) {
				toast({ title: 'Template saved', description: 'Layer document stored.' });
			}
		} catch (err) {
			toast({
				title: 'Save failed',
				description: err.message || 'Could not save template',
				variant: 'destructive',
			});
			throw err;
		} finally {
			setSaving(false);
		}
	}

	saveRef.current = handleManualSave;

	useEffect(() => {
		bindEditorAutosave({
			onSave: async () => {
				await saveRef.current?.({ silent: true });
			},
			debounceMs: 2500,
		});
	}, [id]);

	if (loading) {
		return (
			<div className="tpl-editor-page tpl-editor-page--center" role="status" aria-live="polite">
				<Spinner className="h-5 w-5" />
				<p className="tpl-editor-loading-text">Loading editor…</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="tpl-editor-page tpl-editor-page--center" role="alert">
				<p>{error}</p>
				<div className="tpl-editor-error-actions">
					<button type="button" onClick={() => window.location.reload()}>Retry</button>
					<Link to="/app/ai-pins/templates">Back to gallery</Link>
					{upgradePayload ? (
						<button type="button" onClick={() => setUpgradeOpen(true)}>
							View upgrade options
						</button>
					) : null}
				</div>
				<UpgradeModal
					open={upgradeOpen}
					onClose={() => setUpgradeOpen(false)}
					templateId={upgradePayload?.templateId || ''}
					templateName={upgradePayload?.templateName || ''}
					access={upgradePayload?.access || null}
					sourcePage={upgradePayload?.sourcePage || 'template_editor'}
				/>
			</div>
		);
	}

	return (
		<div className="tpl-editor-page">
			<TemplateEditorShell onManualSave={() => handleManualSave()} saving={saving} />
		</div>
	);
}
