import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	Eye, FileText, Loader2, Plus, Save, Search, Trash2, UploadCloud, History, RotateCcw,
} from 'lucide-react';
import { AdminHero, StatusPill, AdminEmptyState } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { useToast } from '@/hooks/use-toast';
import './AdminLegalPagesPage.css';

const SLUG_OPTIONS = [
	{ value: 'privacy', label: 'Privacy Policy' },
	{ value: 'terms', label: 'Terms of Service' },
	{ value: 'cookies', label: 'Cookie Policy' },
	{ value: 'disclaimer', label: 'Disclaimer' },
	{ value: 'refund', label: 'Refund Policy' },
];

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

function emptyDraft(slug = 'privacy') {
	const option = SLUG_OPTIONS.find((item) => item.value === slug) || SLUG_OPTIONS[0];
	return {
		slug: option.value,
		title: option.label,
		seoTitle: `${option.label} | Chef IA`,
		metaDescription: '',
		content: `# ${option.label}\n\n`,
		status: 'draft',
		version: 1,
		updatedAt: '',
		updatedBy: '',
	};
}

export default function AdminLegalPagesPage() {
	const { toast } = useToast();
	const [items, setItems] = useState([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [query, setQuery] = useState('');
	const [selectedSlug, setSelectedSlug] = useState('');
	const [form, setForm] = useState(emptyDraft());
	const [isNew, setIsNew] = useState(false);
	const [showPreview, setShowPreview] = useState(true);
	const [versions, setVersions] = useState([]);
	const [versionsLoading, setVersionsLoading] = useState(false);

	const load = useCallback(async (preferredSlug = '') => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/legal-pages${query ? `?q=${encodeURIComponent(query)}` : ''}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			const list = Array.isArray(payload.items) ? payload.items : [];
			setItems(list);
			const nextSlug = preferredSlug || selectedSlug || list[0]?.slug || '';
			if (nextSlug) {
				const match = list.find((item) => item.slug === nextSlug) || list[0];
				if (match) {
					setSelectedSlug(match.slug);
					setIsNew(false);
					setForm({
						slug: match.slug,
						title: match.title,
						seoTitle: match.seoTitle,
						metaDescription: match.metaDescription,
						content: match.content,
						status: match.status,
						version: match.version,
						updatedAt: match.updatedAt,
						updatedBy: match.updatedBy,
					});
				}
			}
		} catch (error) {
			toast({ variant: 'destructive', title: 'Legal pages failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [query, selectedSlug, toast]);

	useEffect(() => {
		load();
		// intentionally once on mount; search triggers explicit reload
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const loadVersions = useCallback(async (slug) => {
		if (!slug) {
			setVersions([]);
			return;
		}
		setVersionsLoading(true);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/legal-pages/${encodeURIComponent(slug)}/versions`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setVersions(Array.isArray(payload.items) ? payload.items : []);
		} catch (error) {
			setVersions([]);
			toast({ variant: 'destructive', title: 'Versions failed', description: error.message });
		} finally {
			setVersionsLoading(false);
		}
	}, [toast]);

	useEffect(() => {
		if (selectedSlug && !isNew) loadVersions(selectedSlug);
		else setVersions([]);
	}, [selectedSlug, isNew, loadVersions]);

	const previewHtml = useMemo(() => renderMarkdownToHtml(form.content), [form.content]);

	const selectPage = (item) => {
		setIsNew(false);
		setSelectedSlug(item.slug);
		setForm({
			slug: item.slug,
			title: item.title,
			seoTitle: item.seoTitle,
			metaDescription: item.metaDescription,
			content: item.content,
			status: item.status,
			version: item.version,
			updatedAt: item.updatedAt,
			updatedBy: item.updatedBy,
		});
	};

	const startCreate = () => {
		const used = new Set(items.map((item) => item.slug));
		const available = SLUG_OPTIONS.find((option) => !used.has(option.value));
		if (!available) {
			toast({ variant: 'destructive', title: 'All legal pages already exist' });
			return;
		}
		setIsNew(true);
		setSelectedSlug(available.value);
		setForm(emptyDraft(available.value));
		setVersions([]);
	};

	const save = async (statusOverride) => {
		setSaving(true);
		try {
			const body = {
				slug: form.slug,
				title: form.title,
				seoTitle: form.seoTitle,
				metaDescription: form.metaDescription,
				content: form.content,
				status: statusOverride || form.status,
			};
			const response = await apiServerClient.fetch(
				isNew ? '/admin/v1/legal-pages' : `/admin/v1/legal-pages/${encodeURIComponent(form.slug)}`,
				{
					method: isNew ? 'POST' : 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				},
			);
			if (!response.ok) throw new Error(await readApiError(response));
			const saved = await response.json();
			toast({ title: statusOverride === 'published' ? 'Published' : 'Draft saved', description: `${saved.title} · v${saved.version}` });
			setIsNew(false);
			await load(saved.slug);
			await loadVersions(saved.slug);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Save failed', description: error.message });
		} finally {
			setSaving(false);
		}
	};

	const unpublish = async () => {
		await save('draft');
	};

	const remove = async () => {
		if (!form.slug || isNew) return;
		const confirmed = window.confirm(`Delete "${form.title}" permanently? This cannot be undone.`);
		if (!confirmed) return;
		setSaving(true);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/legal-pages/${encodeURIComponent(form.slug)}`, {
				method: 'DELETE',
			});
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Legal page deleted' });
			setSelectedSlug('');
			setForm(emptyDraft());
			setIsNew(false);
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Delete failed', description: error.message });
		} finally {
			setSaving(false);
		}
	};

	const restoreVersion = async (version) => {
		const confirmed = window.confirm(`Restore version ${version}? This creates a new version from that snapshot.`);
		if (!confirmed) return;
		setSaving(true);
		try {
			const response = await apiServerClient.fetch(
				`/admin/v1/legal-pages/${encodeURIComponent(form.slug)}/versions/${version}/restore`,
				{ method: 'POST' },
			);
			if (!response.ok) throw new Error(await readApiError(response));
			const saved = await response.json();
			toast({ title: 'Version restored', description: `Now at v${saved.version}` });
			await load(saved.slug);
			await loadVersions(saved.slug);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Restore failed', description: error.message });
		} finally {
			setSaving(false);
		}
	};

	const insertMarkdown = (before, after = '') => {
		setForm((prev) => ({
			...prev,
			content: `${prev.content}${before}text${after}`,
		}));
	};

	return (
		<div className="admin-legal">
			<AdminHero
				title="Legal Pages"
				description="Site Management CMS for Privacy, Terms, Cookies, Disclaimer, and Refund policies."
				action={(
					<button type="button" className="admin-btn admin-btn--primary" onClick={startCreate}>
						<Plus size={13} /> New page
					</button>
				)}
			/>

			<section className="admin-card admin-legal__toolbar">
				<label className="admin-legal__search">
					<Search size={14} />
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search slug, title, status…"
					/>
				</label>
				<button type="button" className="admin-btn" onClick={() => load(selectedSlug)}>
					{loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Search
				</button>
			</section>

			<div className="admin-legal__grid">
				<section className="admin-card admin-legal__list">
					<p className="admin-legal__section-label">Pages</p>
					{loading ? (
						<p className="admin-note flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
					) : null}
					{!loading && items.length === 0 ? (
						<AdminEmptyState title="No legal pages" description="Create the first policy page to get started." />
					) : (
						<div className="admin-list">
							{items.map((item) => (
								<button
									type="button"
									key={item.id || item.slug}
									className={`admin-list__item admin-legal__item ${selectedSlug === item.slug && !isNew ? 'is-active' : ''}`}
									onClick={() => selectPage(item)}
								>
									<span>
										<strong className="block">{item.title}</strong>
										<span style={{ color: 'var(--admin-muted)', fontSize: '0.75rem' }}>
											/{item.slug} · v{item.version}
										</span>
									</span>
									<StatusPill status={item.status} />
								</button>
							))}
						</div>
					)}
				</section>

				<section className="admin-card admin-legal__editor">
					<div className="admin-legal__editor-head">
						<div>
							<p className="admin-legal__section-label">{isNew ? 'Create page' : 'Edit page'}</p>
							{form.updatedAt ? (
								<p className="admin-note">
									Last updated {new Date(form.updatedAt).toLocaleString()} · v{form.version}
									{form.updatedBy ? ` · ${form.updatedBy}` : ''}
								</p>
							) : null}
						</div>
						<div className="admin-legal__actions">
							<button type="button" className="admin-btn" onClick={() => setShowPreview((value) => !value)}>
								<Eye size={13} /> {showPreview ? 'Hide preview' : 'Live preview'}
							</button>
							<button type="button" className="admin-btn" disabled={saving} onClick={() => save('draft')}>
								{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save draft
							</button>
							<button type="button" className="admin-btn admin-btn--primary" disabled={saving} onClick={() => save('published')}>
								<UploadCloud size={13} /> Publish
							</button>
							{!isNew && form.status === 'published' ? (
								<button type="button" className="admin-btn" disabled={saving} onClick={unpublish}>
									Unpublish
								</button>
							) : null}
							{!isNew ? (
								<button type="button" className="admin-btn admin-btn--danger" disabled={saving} onClick={remove}>
									<Trash2 size={13} /> Delete
								</button>
							) : null}
						</div>
					</div>

					<div className="admin-legal__fields">
						<label>
							<span>Slug</span>
							<select
								value={form.slug}
								disabled={!isNew}
								onChange={(event) => {
									const next = emptyDraft(event.target.value);
									setSelectedSlug(next.slug);
									setForm((prev) => ({
										...next,
										content: prev.content?.startsWith('#') ? next.content : prev.content,
										metaDescription: prev.metaDescription,
									}));
								}}
							>
								{SLUG_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>{option.label} (/{option.value})</option>
								))}
							</select>
						</label>
						<label>
							<span>Title</span>
							<input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} />
						</label>
						<label>
							<span>SEO title</span>
							<input value={form.seoTitle} onChange={(event) => setForm((prev) => ({ ...prev, seoTitle: event.target.value }))} />
						</label>
						<label>
							<span>Meta description</span>
							<textarea
								rows={2}
								value={form.metaDescription}
								onChange={(event) => setForm((prev) => ({ ...prev, metaDescription: event.target.value }))}
							/>
						</label>
					</div>

					<div className="admin-legal__md-toolbar">
						<span><FileText size={13} /> Markdown</span>
						<button type="button" onClick={() => insertMarkdown('\n## ', '\n')}>H2</button>
						<button type="button" onClick={() => insertMarkdown('**', '**')}>Bold</button>
						<button type="button" onClick={() => insertMarkdown('*', '*')}>Italic</button>
						<button type="button" onClick={() => insertMarkdown('\n- ', '')}>List</button>
						<button type="button" onClick={() => insertMarkdown('[', '](https://)')}>Link</button>
					</div>

					<div className={`admin-legal__compose ${showPreview ? 'has-preview' : ''}`}>
						<textarea
							className="admin-legal__textarea"
							value={form.content}
							onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))}
							spellCheck
						/>
						{showPreview ? (
							<div className="admin-legal__preview privacy-prose" dangerouslySetInnerHTML={{ __html: previewHtml }} />
						) : null}
					</div>

					{!isNew ? (
						<div className="admin-legal__versions">
							<p className="admin-legal__section-label flex items-center gap-2"><History size={13} /> Version history</p>
							{versionsLoading ? (
								<p className="admin-note flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading versions…</p>
							) : null}
							{!versionsLoading && versions.length === 0 ? (
								<p className="admin-note">No versions yet.</p>
							) : (
								<div className="admin-list">
									{versions.map((version) => (
										<div key={version.id || version.version} className="admin-list__item">
											<span>
												<strong className="block">Version {version.version}</strong>
												<span style={{ color: 'var(--admin-muted)', fontSize: '0.75rem' }}>
													{version.snapshotAt ? new Date(version.snapshotAt).toLocaleString() : '—'}
													{version.updatedBy ? ` · ${version.updatedBy}` : ''}
													{` · ${version.status}`}
												</span>
											</span>
											<button
												type="button"
												className="admin-btn"
												disabled={saving || version.version === form.version}
												onClick={() => restoreVersion(version.version)}
											>
												<RotateCcw size={13} /> Restore
											</button>
										</div>
									))}
								</div>
							)}
						</div>
					) : null}
				</section>
			</div>
		</div>
	);
}
