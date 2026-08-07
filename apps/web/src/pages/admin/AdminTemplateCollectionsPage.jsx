import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Search, Trash2 } from 'lucide-react';
import { AdminEmptyState, AdminHero, StatusPill } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

const CHANNELS = [
	{ value: '', label: 'All channels' },
	{ value: 'pinterest', label: 'Pinterest' },
	{ value: 'facebook', label: 'Facebook' },
	{ value: 'instagram', label: 'Instagram' },
	{ value: 'linkedin', label: 'LinkedIn' },
	{ value: 'twitter', label: 'Twitter / X' },
];

const LIBRARY_SCOPES = [
	{ value: 'official', label: 'Official' },
	{ value: 'premium', label: 'Premium' },
	{ value: 'community', label: 'Community' },
	{ value: 'all', label: 'All libraries' },
];

const STATUSES = [
	{ value: 'draft', label: 'Draft' },
	{ value: 'published', label: 'Published' },
	{ value: 'archived', label: 'Archived' },
];

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || data?.error || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

function emptyCollection() {
	return {
		slug: '',
		name: '',
		channel: 'pinterest',
		libraryScope: 'official',
		description: '',
		coverImageUrl: '',
		sortOrder: 0,
		status: 'draft',
	};
}

export default function AdminTemplateCollectionsPage() {
	const { toast } = useToast();
	const [items, setItems] = useState([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [query, setQuery] = useState('');
	const [channelFilter, setChannelFilter] = useState('');
	const [selectedId, setSelectedId] = useState('');
	const [form, setForm] = useState(emptyCollection);
	const [isNew, setIsNew] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (channelFilter) params.set('channel', channelFilter);
			if (query.trim()) params.set('q', query.trim());
			const response = await apiServerClient.fetch(`/admin/v1/template-collections?${params.toString()}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const data = await response.json();
			setItems(Array.isArray(data.items) ? data.items : []);
		} catch (error) {
			toast({ title: 'Failed to load collections', description: error.message, variant: 'destructive' });
			setItems([]);
		} finally {
			setLoading(false);
		}
	}, [channelFilter, query, toast]);

	useEffect(() => { load(); }, [load]);

	const selected = useMemo(
		() => items.find((item) => item.id === selectedId) || null,
		[items, selectedId],
	);

	useEffect(() => {
		if (isNew) return;
		if (selected) {
			setForm({
				slug: selected.slug,
				name: selected.name,
				channel: selected.channel,
				libraryScope: selected.libraryScope,
				description: selected.description || '',
				coverImageUrl: selected.coverImageUrl || '',
				sortOrder: selected.sortOrder || 0,
				status: selected.status || 'draft',
			});
		}
	}, [selected, isNew]);

	const startNew = () => {
		setIsNew(true);
		setSelectedId('');
		setForm(emptyCollection());
	};

	const save = async () => {
		setSaving(true);
		try {
			const payload = { ...form };
			const response = isNew
				? await apiServerClient.fetch('/admin/v1/template-collections', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				})
				: await apiServerClient.fetch(`/admin/v1/template-collections/${selectedId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
			if (!response.ok) throw new Error(await readApiError(response));
			const saved = await response.json();
			toast({ title: isNew ? 'Collection created' : 'Collection saved' });
			setIsNew(false);
			setSelectedId(saved.id);
			await load();
		} catch (error) {
			toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
		} finally {
			setSaving(false);
		}
	};

	const remove = async () => {
		if (!selectedId || isNew) return;
		if (!window.confirm('Delete this collection? Template rows are not deleted.')) return;
		setSaving(true);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/template-collections/${selectedId}`, {
				method: 'DELETE',
			});
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Collection deleted' });
			setSelectedId('');
			setIsNew(false);
			setForm(emptyCollection());
			await load();
		} catch (error) {
			toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="admin-page">
			<AdminHero
				eyebrow="Marketplace CMS"
				title="Template Collections"
				description="Channel-scoped browse groups for Official, Premium, and Community libraries. Collections organize templates without duplicating configurations."
				action={(
					<button type="button" className="admin-btn admin-btn--primary" onClick={startNew}>
						<Plus size={14} aria-hidden="true" /> New collection
					</button>
				)}
			/>

			<div className="admin-grid admin-grid--2 mt-4">
				<aside className="admin-card">
					<div className="admin-toolbar">
						<label className="admin-field">
							<span className="admin-field__label">Search</span>
							<div className="admin-input-wrap">
								<Search size={14} aria-hidden="true" />
								<input
									type="search"
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder="Name or slug"
								/>
							</div>
						</label>
						<label className="admin-field">
							<span className="admin-field__label">Channel</span>
							<select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
								{CHANNELS.map((option) => (
									<option key={option.value || 'all'} value={option.value}>{option.label}</option>
								))}
							</select>
						</label>
					</div>

					{loading ? (
						<p className="admin-muted"><Loader2 className="inline animate-spin" size={14} /> Loading…</p>
					) : items.length === 0 ? (
						<AdminEmptyState title="No collections" description="Create a collection to organize marketplace templates." />
					) : (
						<ul className="admin-list">
							{items.map((item) => (
								<li key={item.id}>
									<button
										type="button"
										className={`admin-list__item ${selectedId === item.id && !isNew ? 'is-active' : ''}`}
										onClick={() => { setSelectedId(item.id); setIsNew(false); }}
									>
										<span>
											<strong>{item.name}</strong>
											<small>{item.channel} · {item.slug} · {item.memberCount} templates</small>
										</span>
										<StatusPill status={item.status} />
									</button>
								</li>
							))}
						</ul>
					)}
				</aside>

				<section className="admin-card">
					{(selectedId || isNew) ? (
						<form className="admin-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
							<div className="admin-form__grid">
								<label className="admin-field">
									<span className="admin-field__label">Name</span>
									<input
										required
										value={form.name}
										onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
									/>
								</label>
								<label className="admin-field">
									<span className="admin-field__label">Slug</span>
									<input
										required
										value={form.slug}
										onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
									/>
								</label>
								<label className="admin-field">
									<span className="admin-field__label">Channel</span>
									<select
										value={form.channel}
										onChange={(event) => setForm((prev) => ({ ...prev, channel: event.target.value }))}
									>
										{CHANNELS.filter((option) => option.value).map((option) => (
											<option key={option.value} value={option.value}>{option.label}</option>
										))}
									</select>
								</label>
								<label className="admin-field">
									<span className="admin-field__label">Library scope</span>
									<select
										value={form.libraryScope}
										onChange={(event) => setForm((prev) => ({ ...prev, libraryScope: event.target.value }))}
									>
										{LIBRARY_SCOPES.map((option) => (
											<option key={option.value} value={option.value}>{option.label}</option>
										))}
									</select>
								</label>
								<label className="admin-field">
									<span className="admin-field__label">Sort order</span>
									<input
										type="number"
										min="0"
										value={form.sortOrder}
										onChange={(event) => setForm((prev) => ({ ...prev, sortOrder: Number(event.target.value) || 0 }))}
									/>
								</label>
								<label className="admin-field">
									<span className="admin-field__label">Status</span>
									<select
										value={form.status}
										onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
									>
										{STATUSES.map((option) => (
											<option key={option.value} value={option.value}>{option.label}</option>
										))}
									</select>
								</label>
							</div>
							<label className="admin-field">
								<span className="admin-field__label">Description</span>
								<textarea
									rows={3}
									value={form.description}
									onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
								/>
							</label>
							<label className="admin-field">
								<span className="admin-field__label">Cover image URL</span>
								<input
									value={form.coverImageUrl}
									onChange={(event) => setForm((prev) => ({ ...prev, coverImageUrl: event.target.value }))}
								/>
							</label>
							<div className="admin-form__actions">
								<button type="submit" className="admin-btn admin-btn--primary" disabled={saving}>
									{saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
									{isNew ? 'Create collection' : 'Save changes'}
								</button>
								{!isNew ? (
									<button type="button" className="admin-btn admin-btn--danger" onClick={remove} disabled={saving}>
										<Trash2 size={14} /> Delete
									</button>
								) : null}
							</div>
						</form>
					) : (
						<AdminEmptyState title="Select a collection" description="Choose a collection from the list or create a new one." />
					)}
				</section>
			</div>
		</div>
	);
}
