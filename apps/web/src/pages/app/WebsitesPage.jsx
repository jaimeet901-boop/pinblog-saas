import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Plus, Trash2, Pencil, Plug, X } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Card, PageHeader, Button, Input, Badge, Empty, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';

const blank = {
	name: '',
	url: '',
	domain: '',
	favicon: '',
	status: 'active',
	discovery_status: 'pending',
	wp_username: '',
	wp_app_password: '',
};

function isValidHttpUrl(value) {
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

function formatDate(value) {
	if (!value) {
		return '—';
	}

	try {
		return new Date(value).toLocaleDateString();
	} catch {
		return '—';
	}
}

export default function WebsitesPage() {
	const { toast } = useToast();
	const navigate = useNavigate();
	const [sites, setSites] = useState([]);
	const [loading, setLoading] = useState(true);
	const [modal, setModal] = useState(null); // {mode, data}
	const [testing, setTesting] = useState(null);
	const [saving, setSaving] = useState(false);
	const [metadataLoading, setMetadataLoading] = useState(false);
	const [urlError, setUrlError] = useState('');
	const [lastMetadataUrl, setLastMetadataUrl] = useState('');

	const load = async () => {
		try {
			const res = await apiServerClient.fetch('/websites', { method: 'GET' });

			if (!res.ok) {
				const errorBody = await res.text();
				throw new Error(errorBody || `Failed to load websites (${res.status})`);
			}

			setSites(await res.json());
		} catch (_) { /* ignore */ } finally { setLoading(false); }
	};
	useEffect(() => { load(); }, []);

	const setModalData = (patch) => {
		setModal((m) => ({ ...m, data: { ...m.data, ...patch } }));
	};

	const fetchWebsiteMetadata = async (rawUrl) => {
		const normalizedUrl = rawUrl?.trim() || '';

		if (!normalizedUrl) {
			setUrlError('Please enter your website URL.');
			return null;
		}

		if (!isValidHttpUrl(normalizedUrl)) {
			setUrlError('Please enter a valid URL starting with http:// or https://');
			return null;
		}

		setMetadataLoading(true);
		setUrlError('');

		try {
			const res = await apiServerClient.fetch('/websites/metadata', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: normalizedUrl }),
			});

			const data = await res.json().catch(() => ({}));

			if (!res.ok) {
				throw new Error(data?.message || 'Unable to fetch website details.');
			}

			setModalData({
				name: data.name || '',
				url: data.url || normalizedUrl,
				domain: data.domain || '',
				favicon: data.favicon || '',
				status: 'active',
				discovery_status: 'pending',
			});
			setLastMetadataUrl(data.url || normalizedUrl);

			return data;
		} catch (err) {
			setUrlError(err?.message || 'Unable to fetch website details. Please check the URL.');
			return null;
		} finally {
			setMetadataLoading(false);
		}
	};

	const save = async (e) => {
		e.preventDefault();
		const { data, mode } = modal;
		setSaving(true);
		try {
			if (mode === 'new') {
				const metadata = await fetchWebsiteMetadata(data.url);
				if (!metadata) {
					return;
				}
			}

			const payload = {
				name: data.name,
				url: data.url,
				domain: data.domain,
				favicon: data.favicon,
				status: data.status || 'active',
				discovery_status: data.discovery_status || 'pending',
				wp_username: data.wp_username,
				wp_app_password: data.wp_app_password,
			};

			let res;
			if (mode === 'edit') {
				res = await apiServerClient.fetch(`/websites/${data.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
			} else {
				res = await apiServerClient.fetch('/websites', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
			}

			if (!res.ok) {
				let message = `Failed to save website (${res.status})`;
				try {
					const parsed = await res.json();
					message = parsed?.message || parsed?.error || message;
				} catch {
					// use fallback message
				}
				throw new Error(message);
			}

			const savedSite = await res.json();

			if (mode === 'edit') {
				setSites((prev) => prev.map((site) => (site.id === savedSite.id ? savedSite : site)));
			} else {
				setSites((prev) => [savedSite, ...prev]);
			}

			setModal(null);
			setUrlError('');
			setLastMetadataUrl('');

			if (mode === 'new') {
				toast({ title: 'Website added', description: 'Website was added successfully and is ready to scan.' });
				navigate(`/app/websites/${savedSite.id}`);
			} else {
				toast({ title: 'Saved', description: 'Website saved successfully.' });
			}
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	const remove = async (id) => {
		if (!confirm('Delete this website?')) return;
		try {
			const res = await apiServerClient.fetch(`/websites/${id}`, { method: 'DELETE' });

			if (!res.ok) {
				throw new Error(`Failed to delete website (${res.status})`);
			}

			load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message || 'Failed to delete website.' });
		}
	};

	const test = async (site) => {
		setTesting(site.id);
		try {
			const res = await apiServerClient.fetch('/wordpress/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ siteId: site.id }),
			});
			const data = await res.json();

			if (!res.ok) {
				throw new Error(data?.message || `Connection failed (${res.status})`);
			}

			toast({ variant: data.ok ? 'default' : 'destructive', title: data.ok ? 'Connected' : 'Connection failed', description: data.message });
			load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message });
		} finally { setTesting(null); }
	};

	return (
		<div>
			<PageHeader
				title="Website Manager"
				subtitle="Connect unlimited WordPress sites and publish directly."
				action={<Button onClick={() => {
					setModal({ mode: 'new', data: { ...blank } });
					setUrlError('');
					setLastMetadataUrl('');
				}}><Plus size={16} /> Add website</Button>}
			/>

			{loading ? (
				<div className="flex justify-center py-16"><Spinner className="text-primary" /></div>
			) : sites.length === 0 ? (
				<Empty icon={Globe} title="No websites yet" subtitle="Add your first WordPress site to start publishing."
					action={<Button onClick={() => {
						setModal({ mode: 'new', data: { ...blank } });
						setUrlError('');
						setLastMetadataUrl('');
					}}><Plus size={16} /> Add website</Button>} />
			) : (
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					{sites.map((s) => (
						<Card key={s.id}>
							<div className="flex items-start justify-between">
								{s.favicon ? (
									<img src={s.favicon} alt={`${s.name} favicon`} loading="lazy" decoding="async" className="h-10 w-10 rounded-xl border border-border object-cover" />
								) : (
									<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Globe size={19} /></span>
								)}
								<Badge tone={s.status === 'active' ? 'green' : s.status === 'failed' ? 'red' : 'default'}>{s.status || 'active'}</Badge>
							</div>
							<h3 className="mt-3 truncate font-semibold">{s.name}</h3>
							<a href={s.url} target="_blank" rel="noreferrer" className="block truncate text-sm text-muted-foreground hover:text-primary">{s.url}</a>
							<p className="mt-1 text-xs text-muted-foreground">Domain: {s.domain || '—'}</p>
							<p className="mt-1 text-xs text-muted-foreground">Discovery: {s.discovery_status || 'pending'}</p>
							<p className="mt-1 text-xs text-muted-foreground">Created: {formatDate(s.created)}</p>
							<div className="mt-4 flex gap-2">
								<Button size="sm" onClick={() => navigate(`/app/websites/${s.id}`)}>Dashboard</Button>
								<Button size="sm" variant="outline" onClick={() => navigate(`/app/websites/${s.id}/articles`)}>Articles</Button>
								<Button size="sm" variant="outline" onClick={() => test(s)} disabled={testing === s.id}>
									{testing === s.id ? <Spinner className="h-3.5 w-3.5" /> : <Plug size={14} />} Test
								</Button>
								<Button size="sm" variant="ghost" onClick={() => {
									setModal({ mode: 'edit', data: { ...blank, ...s } });
									setUrlError('');
									setLastMetadataUrl('');
								}}><Pencil size={14} /></Button>
								<Button size="sm" variant="ghost" onClick={() => remove(s.id)}><Trash2 size={14} className="text-destructive" /></Button>
							</div>
						</Card>
					))}
				</div>
			)}

			{modal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModal(null)}>
					<Card className="w-full max-w-md" >
						<div onClick={(e) => e.stopPropagation()}>
							<div className="mb-4 flex items-center justify-between">
								<h3 className="font-display text-lg font-600">{modal.mode === 'edit' ? 'Edit website' : 'Add website'}</h3>
								<button onClick={() => setModal(null)}><X size={18} /></button>
							</div>
							<form onSubmit={save} className="space-y-3">
								<Input
									label="Website URL"
									type="url"
									required
									value={modal.data.url}
									onChange={(e) => {
										setModalData({ url: e.target.value });
										setUrlError('');
										if (lastMetadataUrl && lastMetadataUrl !== e.target.value.trim()) {
											setLastMetadataUrl('');
										}
									}}
									onBlur={async () => {
										if (modal.mode !== 'new') {
											return;
										}

										const trimmed = modal.data.url.trim();
										if (!trimmed || trimmed === lastMetadataUrl) {
											return;
										}

										await fetchWebsiteMetadata(trimmed);
									}}
									placeholder="https://myblog.com"
								/>
								{urlError && <p className="text-xs text-destructive">{urlError}</p>}

								{metadataLoading && (
									<div className="flex items-center gap-2 text-xs text-muted-foreground">
										<Spinner className="h-3.5 w-3.5" /> Fetching website details...
									</div>
								)}

								{modal.data.domain && (
									<div className="rounded-xl border border-border bg-secondary/40 p-3">
										<div className="flex items-center gap-2">
											{modal.data.favicon ? (
												<img src={modal.data.favicon} alt="Website favicon" loading="lazy" decoding="async" className="h-5 w-5 rounded" />
											) : (
												<Globe size={16} className="text-muted-foreground" />
											)}
											<p className="text-sm font-medium">{modal.data.name || modal.data.domain}</p>
										</div>
										<p className="mt-1 text-xs text-muted-foreground">Domain: {modal.data.domain}</p>
									</div>
								)}

								<Input label="Website name" required value={modal.data.name} onChange={(e) => setModalData({ name: e.target.value })} placeholder="My Food Blog" />
								{modal.mode === 'edit' && (
									<>
										<Input label="WordPress username" value={modal.data.wp_username} onChange={(e) => setModalData({ wp_username: e.target.value })} placeholder="admin" />
										<Input label="Application password" type="password" value={modal.data.wp_app_password || ''} onChange={(e) => setModalData({ wp_app_password: e.target.value })} placeholder="xxxx xxxx xxxx xxxx" />
									</>
								)}
								<div className="flex justify-end gap-2 pt-2">
									<Button type="button" variant="outline" onClick={() => setModal(null)}>Cancel</Button>
									<Button type="submit" disabled={saving || metadataLoading}>{saving ? 'Saving...' : 'Save'}</Button>
								</div>
							</form>
						</div>
					</Card>
				</div>
			)}
		</div>
	);
}
