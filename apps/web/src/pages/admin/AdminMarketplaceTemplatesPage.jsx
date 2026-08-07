import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Loader2, Save, Search } from 'lucide-react';
import { AdminEmptyState, AdminHero, StatusPill } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';
import { TEMPLATE_CATEGORIES } from '@/lib/pinEngineConstants';

const CHANNELS = [
	{ value: '', label: 'All channels' },
	{ value: 'pinterest', label: 'Pinterest' },
	{ value: 'facebook', label: 'Facebook' },
];

const STATUSES = [
	{ value: '', label: 'All statuses' },
	{ value: 'published', label: 'Published' },
	{ value: 'draft', label: 'Draft' },
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

export default function AdminMarketplaceTemplatesPage() {
	const { toast } = useToast();
	const [items, setItems] = useState([]);
	const [collections, setCollections] = useState([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [query, setQuery] = useState('');
	const [channelFilter, setChannelFilter] = useState('');
	const [statusFilter, setStatusFilter] = useState('');
	const [selectedId, setSelectedId] = useState('');
	const [form, setForm] = useState(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (channelFilter) params.set('channel', channelFilter);
			if (statusFilter) params.set('status', statusFilter);
			if (query.trim()) params.set('q', query.trim());
			const response = await apiServerClient.fetch(`/admin/v1/marketplace-templates?${params.toString()}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const data = await response.json();
			setItems(Array.isArray(data.items) ? data.items : []);
		} catch (error) {
			toast({ title: 'Failed to load templates', description: error.message, variant: 'destructive' });
			setItems([]);
		} finally {
			setLoading(false);
		}
	}, [channelFilter, query, statusFilter, toast]);

	const loadCollections = useCallback(async () => {
		try {
			const response = await apiServerClient.fetch('/admin/v1/template-collections?status=published');
			if (!response.ok) return;
			const data = await response.json();
			setCollections(Array.isArray(data.items) ? data.items : []);
		} catch {
			setCollections([]);
		}
	}, []);

	useEffect(() => { load(); loadCollections(); }, [load, loadCollections]);

	const selected = useMemo(
		() => items.find((item) => item.id === selectedId) || null,
		[items, selectedId],
	);

	useEffect(() => {
		if (!selected) {
			setForm(null);
			return;
		}
		setForm({
			name: selected.name,
			category: selected.category,
			status: selected.status,
			channel: selected.channel,
			collectionIds: (selected.collections || []).map((item) => item.id),
		});
	}, [selected]);

	const channelCollections = useMemo(
		() => collections.filter((item) => !form?.channel || item.channel === form.channel),
		[collections, form?.channel],
	);

	const save = async () => {
		if (!selectedId || !form) return;
		setSaving(true);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/marketplace-templates/${selectedId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(form),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Template saved' });
			await load();
		} catch (error) {
			toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
		} finally {
			setSaving(false);
		}
	};

	const archive = async () => {
		if (!selectedId) return;
		if (!window.confirm('Archive this official template? It will disappear from customer galleries.')) return;
		setSaving(true);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/marketplace-templates/${selectedId}/archive`, {
				method: 'POST',
			});
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Template archived' });
			setSelectedId('');
			await load();
		} catch (error) {
			toast({ title: 'Archive failed', description: error.message, variant: 'destructive' });
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="admin-page">
			<AdminHero
				eyebrow="Marketplace CMS"
				title="Official Templates"
				description="Manage Official marketplace templates after bootstrap. The seeder only creates missing rows — Admin edits are preserved (Phase 1 policy)."
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
									placeholder="Name or UUID"
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
						<label className="admin-field">
							<span className="admin-field__label">Status</span>
							<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
								{STATUSES.map((option) => (
									<option key={option.value || 'all'} value={option.value}>{option.label}</option>
								))}
							</select>
						</label>
					</div>

					{loading ? (
						<p className="admin-muted"><Loader2 className="inline animate-spin" size={14} /> Loading…</p>
					) : items.length === 0 ? (
						<AdminEmptyState title="No official templates" description="Bootstrap the catalog on deploy, then manage templates here." />
					) : (
						<ul className="admin-list">
							{items.map((item) => (
								<li key={item.id}>
									<button
										type="button"
										className={`admin-list__item ${selectedId === item.id ? 'is-active' : ''}`}
										onClick={() => setSelectedId(item.id)}
									>
										<span>
											<strong>{item.name}</strong>
											<small>{item.channel} · {item.templateUuid || item.id}</small>
										</span>
										<StatusPill status={item.status} />
									</button>
								</li>
							))}
						</ul>
					)}
				</aside>

				<section className="admin-card">
					{selected && form ? (
						<form className="admin-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
							<p className="admin-muted">UUID: {selected.templateUuid || '—'}</p>
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
									<span className="admin-field__label">Category</span>
									<select
										value={form.category}
										onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
									>
										{TEMPLATE_CATEGORIES.map((category) => (
											<option key={category} value={category}>{category}</option>
										))}
									</select>
								</label>
								<label className="admin-field">
									<span className="admin-field__label">Status</span>
									<select
										value={form.status}
										onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
									>
										{STATUSES.filter((option) => option.value).map((option) => (
											<option key={option.value} value={option.value}>{option.label}</option>
										))}
									</select>
								</label>
							</div>
							<fieldset className="admin-field">
								<legend className="admin-field__label">Collections</legend>
								{channelCollections.length === 0 ? (
									<p className="admin-muted">No published collections for this channel yet.</p>
								) : (
									<div className="admin-checkbox-grid">
										{channelCollections.map((collection) => (
											<label key={collection.id} className="admin-checkbox">
												<input
													type="checkbox"
													checked={form.collectionIds.includes(collection.id)}
													onChange={(event) => {
														setForm((prev) => {
															const next = new Set(prev.collectionIds);
															if (event.target.checked) next.add(collection.id);
															else next.delete(collection.id);
															return { ...prev, collectionIds: [...next] };
														});
													}}
												/>
												{collection.name} ({collection.slug})
											</label>
										))}
									</div>
								)}
							</fieldset>
							<div className="admin-form__actions">
								<button type="submit" className="admin-btn admin-btn--primary" disabled={saving}>
									{saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
									Save changes
								</button>
								<button type="button" className="admin-btn admin-btn--danger" onClick={archive} disabled={saving}>
									<Archive size={14} /> Archive
								</button>
							</div>
						</form>
					) : (
						<AdminEmptyState title="Select a template" description="Choose an official template to edit placement metadata and collections." />
					)}
				</section>
			</div>
		</div>
	);
}
