import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	Eye, FileText, Loader2, Plus, Save, Search, Trash2, UploadCloud, History, RotateCcw, Sparkles,
} from 'lucide-react';
import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { useToast } from '@/hooks/use-toast';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';
import { DEFAULT_PLATFORM_NAME } from '@/lib/platformIdentity';
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
		return data?.message
			|| data?.data?.message
			|| data?.error
			|| `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

function emptyDraft(slug = 'privacy', platformName = DEFAULT_PLATFORM_NAME) {
	const option = SLUG_OPTIONS.find((item) => item.value === slug) || SLUG_OPTIONS[0];
	return {
		slug: option.value,
		title: option.label,
		seoTitle: `${option.label} | ${platformName}`,
		metaDescription: '',
		content: `# ${option.label}\n\n`,
		status: 'draft',
		version: 1,
		updatedAt: '',
		updatedBy: '',
	};
}

function applyPageToForm(page) {
	return {
		slug: page.slug,
		title: page.title,
		seoTitle: page.seoTitle,
		metaDescription: page.metaDescription,
		content: page.content,
		status: page.status,
		version: page.version,
		updatedAt: page.updatedAt,
		updatedBy: page.updatedBy,
	};
}

export default function AdminLegalPagesPage() {
	const { toast } = useToast();
	const { platformName } = usePlatformIdentity();
	const [items, setItems] = useState([]);
	const [quickStart, setQuickStart] = useState([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [creatingSlug, setCreatingSlug] = useState('');
	const [query, setQuery] = useState('');
	const [selectedSlug, setSelectedSlug] = useState('');
	const [form, setForm] = useState(() => emptyDraft('privacy', DEFAULT_PLATFORM_NAME));
	const [isNew, setIsNew] = useState(false);
	const [showPreview, setShowPreview] = useState(true);
	const [versions, setVersions] = useState([]);
	const [versionsLoading, setVersionsLoading] = useState(false);

	const loadQuickStart = useCallback(async () => {
		const response = await apiServerClient.fetch('/admin/v1/legal-pages/quick-start');
		if (!response.ok) throw new Error(await readApiError(response));
		const payload = await response.json();
		setQuickStart(Array.isArray(payload.items) ? payload.items : []);
		return payload;
	}, []);

	const load = useCallback(async (preferredSlug = '') => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/legal-pages${query ? `?q=${encodeURIComponent(query)}` : ''}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			const list = Array.isArray(payload.items) ? payload.items : [];
			setItems(list);
			await loadQuickStart().catch(() => null);

			const nextSlug = preferredSlug || selectedSlug || list[0]?.slug || '';
			if (nextSlug) {
				const match = list.find((item) => item.slug === nextSlug) || list[0];
				if (match) {
					setSelectedSlug(match.slug);
					setIsNew(false);
					setForm(applyPageToForm(match));
				}
			} else if (!list.length) {
				setSelectedSlug('');
				setIsNew(false);
				setForm(emptyDraft('privacy', platformName));
				setVersions([]);
			}
		} catch (error) {
			toast({ variant: 'destructive', title: 'Legal pages failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [loadQuickStart, platformName, query, selectedSlug, toast]);

	useEffect(() => {
		load();
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
	const existingSlugs = useMemo(() => new Set(items.map((item) => item.slug)), [items]);
	const showQuickStartPanel = !loading && (items.length === 0 || quickStart.some((item) => !item.created));

	const selectPage = (item) => {
		setIsNew(false);
		setSelectedSlug(item.slug);
		setForm(applyPageToForm(item));
	};

	const createFromTemplate = async (slug) => {
		if (existingSlugs.has(slug) || creatingSlug) return;
		setCreatingSlug(slug);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/legal-pages/quick-start/${encodeURIComponent(slug)}`, {
				method: 'POST',
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const created = await response.json();
			toast({
				title: 'Legal page created',
				description: `${created.title} was created as a draft from the Quick Start template.`,
			});
			setIsNew(false);
			setSelectedSlug(created.slug);
			setForm(applyPageToForm(created));
			await load(created.slug);
			await loadVersions(created.slug);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Create failed', description: error.message });
		} finally {
			setCreatingSlug('');
		}
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
			setForm(emptyDraft('privacy', platformName));
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
			/>

			<section className="admin-card admin-legal__quick-actions">
				<p className="admin-legal__section-label">Quick Actions</p>
				<div className="admin-legal__quick-actions-row">
					{(quickStart.length ? quickStart : SLUG_OPTIONS.map((option) => ({
						slug: option.value,
						title: option.label,
						created: existingSlugs.has(option.value),
					}))).map((item) => {
						const created = Boolean(item.created || existingSlugs.has(item.slug));
						const busy = creatingSlug === item.slug;
						return (
							<button
								key={item.slug}
								type="button"
								className="admin-btn"
								disabled={created || Boolean(creatingSlug)}
								onClick={() => createFromTemplate(item.slug)}
								title={created ? 'Already Created' : `Create ${item.title}`}
							>
								{busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
								{created ? `${item.title} · Already Created` : item.title}
							</button>
						);
					})}
				</div>
			</section>

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

			{showQuickStartPanel ? (
				<section className="admin-card admin-legal__quick-start">
					<div className="admin-legal__quick-start-head">
						<p className="admin-legal__section-label flex items-center gap-2">
							<Sparkles size={13} /> Quick Start
						</p>
						<p className="admin-note">
							{items.length === 0
								? 'No legal pages yet. Create professionally written drafts with one click.'
								: 'Some legal pages are still missing. Create drafts without overwriting existing content.'}
						</p>
					</div>
					<div className="admin-legal__cards">
						{quickStart.map((card) => {
							const created = Boolean(card.created);
							const busy = creatingSlug === card.slug;
							return (
								<article key={card.slug} className={`admin-legal__card ${created ? 'is-created' : ''}`}>
									<div className="admin-legal__card-top">
										<strong>{card.title}</strong>
										<span className={`admin-legal__badge ${created ? 'is-created' : 'is-missing'}`}>
											{created ? 'Created' : 'Not Created'}
										</span>
									</div>
									<p>{card.description}</p>
									<div className="admin-legal__card-meta">
										<span>Slug {card.path || `/${card.slug}`}</span>
										<span>~{card.estimatedReadingMinutes || 1} min read</span>
									</div>
									<button
										type="button"
										className="admin-btn admin-btn--primary"
										disabled={created || Boolean(creatingSlug)}
										onClick={() => createFromTemplate(card.slug)}
									>
										{busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
										{created ? 'Already Created' : 'Create'}
									</button>
								</article>
							);
						})}
					</div>
				</section>
			) : null}

			<div className="admin-legal__grid">
				<section className="admin-card admin-legal__list">
					<p className="admin-legal__section-label">Pages</p>
					{loading ? (
						<p className="admin-note flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
					) : null}
					{!loading && items.length === 0 ? (
						<p className="admin-note">Use Quick Start above to create your first legal page draft.</p>
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
					{!items.length && !isNew ? (
						<div className="admin-legal__editor-empty">
							<p className="admin-legal__section-label">Editor</p>
							<p className="admin-note">Select a page or create one from Quick Start to begin editing.</p>
						</div>
					) : (
						<>
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
											const next = emptyDraft(event.target.value, platformName);
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
						</>
					)}
				</section>
			</div>
		</div>
	);
}
