import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Plus, Trash2, Plug, X } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { notifyWebsitesChanged } from '@/lib/websites/websitesChanged';
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

function formatDateTime(value) {
	if (!value) {
		return '—';
	}

	try {
		return new Date(value).toLocaleString();
	} catch {
		return '—';
	}
}

function statusTone(status) {
	const value = String(status || '').toLowerCase();
	if (['connected', 'active', 'ready', 'healthy', 'operational', 'ok', 'published', 'completed', 'configured'].includes(value)) {
		return 'green';
	}
	if (['failed', 'error', 'down', 'disconnected', 'not_configured', 'missing'].includes(value)) {
		return 'red';
	}
	if (['running', 'scanning', 'queued', 'pending', 'degraded', 'scheduled', 'paused', 'untested', 'idle', 'needs_attention', 'not_tracked'].includes(value)) {
		return 'amber';
	}
	return 'default';
}

function formatRelative(value, emptyLabel = 'Not available') {
	if (!value) return emptyLabel;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return emptyLabel;
	const diffMs = Date.now() - date.getTime();
	const mins = Math.round(diffMs / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	const days = Math.round(hours / 24);
	if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
	return formatDateTime(value);
}

function displayValue(value, emptyLabel = 'Not available') {
	if (value == null || value === '') return emptyLabel;
	return value;
}

function displayCount(value, emptyLabel = 'Not available') {
	if (value == null || value === '') return emptyLabel;
	if (!Number.isFinite(Number(value))) return emptyLabel;
	return Number(value);
}

function StatusLine({ ok, label, missingLabel }) {
	const ready = Boolean(ok);
	return (
		<p className="text-xs text-muted-foreground">
			{ready ? '✅' : '❌'} {ready ? label : (missingLabel || label)}
		</p>
	);
}

function Section({ title, children, className = '' }) {
	return (
		<div className={`space-y-1 border-t border-border pt-3 ${className}`.trim()}>
			<p className="text-xs font-medium text-muted-foreground">{title}</p>
			{children}
		</div>
	);
}

function deriveFallbackMetadata(rawUrl) {
	try {
		const parsed = new URL(rawUrl);
		const domain = parsed.hostname.replace(/^www\./, '');
		return {
			name: domain,
			url: parsed.origin,
			domain,
			favicon: `${parsed.origin}/favicon.ico`,
		};
	} catch {
		return {
			name: '',
			url: rawUrl,
			domain: '',
			favicon: '',
		};
	}
}

async function readErrorMessage(res, fallback) {
	try {
		const parsed = await res.json();
		return parsed?.message || parsed?.error || fallback;
	} catch {
		return fallback;
	}
}

export default function WebsitesPage() {
	const { toast } = useToast();
	const navigate = useNavigate();
	const [sites, setSites] = useState([]);
	const [workspaceIndicators, setWorkspaceIndicators] = useState(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState('');
	const [modal, setModal] = useState(null); // {mode, data}
	const [testing, setTesting] = useState(null);
	const [saving, setSaving] = useState(false);
	const [metadataLoading, setMetadataLoading] = useState(false);
	const [urlError, setUrlError] = useState('');
	const [lastMetadataUrl, setLastMetadataUrl] = useState('');

	const load = async () => {
		setLoading(true);
		setLoadError('');
		try {
			const res = await apiServerClient.fetch('/websites/control-center', { method: 'GET' });

			if (!res.ok) {
				// Fallback to classic list if control-center is unavailable.
				const fallback = await apiServerClient.fetch('/websites', { method: 'GET' });
				if (!fallback.ok) {
					const message = await readErrorMessage(fallback, `Failed to load websites (${fallback.status})`);
					throw new Error(message);
				}
				const payload = await fallback.json();
				setSites(Array.isArray(payload) ? payload : []);
				setWorkspaceIndicators(null);
				return;
			}

			const payload = await res.json();
			setSites(Array.isArray(payload?.items) ? payload.items : []);
			setWorkspaceIndicators(payload?.indicators || null);
		} catch (err) {
			setSites([]);
			setWorkspaceIndicators(null);
			setLoadError(err?.message || 'Failed to load websites.');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
	}, []);

	const setModalData = (patch) => {
		setModal((m) => ({ ...m, data: { ...m.data, ...patch } }));
	};

	const fetchWebsiteMetadata = async (rawUrl, { allowFallback = false } = {}) => {
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
				if (res.status === 429 && allowFallback) {
					const fallback = deriveFallbackMetadata(normalizedUrl);
					setModalData({
						...fallback,
						status: 'active',
						discovery_status: 'pending',
					});
					setLastMetadataUrl(fallback.url || normalizedUrl);
					setUrlError('Rate limit reached while fetching details. You can still save with the URL and name.');
					return fallback;
				}
				throw new Error(data?.message || data?.error || 'Unable to fetch website details.');
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
			if (allowFallback) {
				const fallback = deriveFallbackMetadata(normalizedUrl);
				setModalData({
					...fallback,
					status: 'active',
					discovery_status: 'pending',
				});
				setLastMetadataUrl(fallback.url || normalizedUrl);
				setUrlError('Could not auto-fetch site details. You can still save with the URL and name.');
				return fallback;
			}

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
			let working = data;

			if (mode === 'new') {
				if (!isValidHttpUrl(data.url?.trim() || '')) {
					setUrlError('Please enter a valid URL starting with http:// or https://');
					return;
				}

				const trimmedUrl = data.url.trim();
				const alreadyHydrated = Boolean(
					lastMetadataUrl
					&& lastMetadataUrl === trimmedUrl
					&& data.name?.trim()
					&& data.domain?.trim(),
				);

				if (!alreadyHydrated) {
					// Prefer live metadata, but never block save if the remote site is unreachable.
					const metadata = await fetchWebsiteMetadata(trimmedUrl, { allowFallback: true });
					if (!metadata) {
						return;
					}
					working = {
						...data,
						name: data.name?.trim() ? data.name : metadata.name,
						url: metadata.url || data.url,
						domain: metadata.domain || data.domain,
						favicon: metadata.favicon || data.favicon,
					};
				}
			}

			if (!working.name?.trim()) {
				toast({ variant: 'destructive', title: 'Error', description: 'Website name is required.' });
				return;
			}

			const payload = {
				name: working.name.trim(),
				url: working.url,
				domain: working.domain,
				favicon: working.favicon,
				status: working.status || 'active',
				discovery_status: working.discovery_status || 'pending',
				wp_username: working.wp_username,
				wp_app_password: working.wp_app_password,
			};

			let res;
			if (mode === 'edit') {
				res = await apiServerClient.fetch(`/websites/${working.id}`, {
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
				throw new Error(await readErrorMessage(res, `Failed to save website (${res.status})`));
			}

			const savedSite = await res.json();
			if (!savedSite?.id) {
				throw new Error('Website save succeeded but returned an invalid record.');
			}

			if (mode === 'edit') {
				setSites((prev) => prev.map((site) => (site.id === savedSite.id ? savedSite : site)));
			} else {
				setSites((prev) => [savedSite, ...prev]);
			}

			// Success-only: never emit on failed/cancelled create/update/reconnect.
			notifyWebsitesChanged({ reason: mode === 'edit' ? 'update' : 'create', websiteId: savedSite.id });

			setModal(null);
			setUrlError('');
			setLastMetadataUrl('');

			if (mode === 'edit') {
				toast({ title: 'Saved', description: 'Website saved successfully.' });
				await load();
			} else {
				toast({ title: 'Website added', description: 'Website was added successfully and is ready to scan.' });
				navigate(`/app/websites/${savedSite.id}`);
			}
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	const remove = async (site) => {
		const id = site?.id;
		const confirmDomain = String(site?.domain || site?.url || site?.name || '').trim();
		if (!confirm('Delete this website?')) return;
		if (!id) return;
		try {
			const res = await apiServerClient.fetch(`/websites/${id}`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ confirmDomain }),
			});

			if (!res.ok) {
				throw new Error(await readErrorMessage(res, `Failed to delete website (${res.status})`));
			}

			setSites((prev) => prev.filter((site) => site.id !== id));
			// Success-only: never emit on failed/cancelled delete.
			notifyWebsitesChanged({ reason: 'delete', websiteId: id });
			toast({ title: 'Deleted', description: 'Website removed.' });
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
			const data = await res.json().catch(() => ({}));

			if (!res.ok) {
				throw new Error(data?.message || `Connection failed (${res.status})`);
			}

			toast({ variant: data.ok ? 'default' : 'destructive', title: data.ok ? 'Connected' : 'Connection failed', description: data.message });
			load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message });
		} finally {
			setTesting(null);
		}
	};

	const openNewModal = () => {
		setModal({ mode: 'new', data: { ...blank } });
		setUrlError('');
		setLastMetadataUrl('');
	};

	return (
		<div>
			<PageHeader
				title="Website Manager"
				subtitle="Add your sites, validate the URL, save to PocketBase, then scan to discover articles."
				action={<Button onClick={openNewModal}><Plus size={16} /> Add website</Button>}
			/>

			{loading ? (
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					{[1, 2, 3].map((key) => (
						<Card key={key}>
							<div className="h-10 w-10 animate-pulse rounded-xl bg-secondary" />
							<div className="mt-3 h-5 w-2/3 animate-pulse rounded bg-secondary" />
							<div className="mt-2 h-4 w-full animate-pulse rounded bg-secondary" />
							<div className="mt-4 space-y-2">
								<div className="h-3 w-full animate-pulse rounded bg-secondary" />
								<div className="h-3 w-5/6 animate-pulse rounded bg-secondary" />
								<div className="h-3 w-4/6 animate-pulse rounded bg-secondary" />
							</div>
						</Card>
					))}
				</div>
			) : loadError ? (
				<Empty
					icon={Globe}
					title="Unable to load websites"
					subtitle={loadError}
					action={<Button onClick={() => { setLoading(true); load(); }}>Retry</Button>}
				/>
			) : sites.length === 0 ? (
				<Empty
					icon={Globe}
					title="No websites yet"
					subtitle="Add your first site to start scanning and discovering articles."
					action={<Button onClick={openNewModal}><Plus size={16} /> Add website</Button>}
				/>
			) : (
				<>
					{workspaceIndicators && (
						<div className="mb-4 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
							{[
								workspaceIndicators.aiImageProvider,
								workspaceIndicators.pinterestConnection,
								workspaceIndicators.brandKitAssigned,
								workspaceIndicators.publishingQueue,
								workspaceIndicators.scheduler,
							].filter(Boolean).map((item) => (
								<Card key={item.label}>
									<p className="text-sm text-muted-foreground">{item.label}</p>
									<div className="mt-2 flex items-center gap-2">
										<Badge tone={item.tone || statusTone(item.status)}>{item.status || '—'}</Badge>
									</div>
									{item.detail ? <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p> : null}
								</Card>
							))}
						</div>
					)}

					<div className="grid gap-4 md:grid-cols-2">
						{sites.map((s) => {
							const health = s.control?.health || {};
							const wordpress = s.control?.wordpress || {};
							const publishingHealth = s.control?.publishingHealth || {};
							const credentialsHealth = s.control?.credentialsHealth || {};
							const siteInfo = s.control?.siteInfo || {};
							const recentActivity = Array.isArray(s.control?.recentActivity) ? s.control.recentActivity : [];
							const openSettings = () => {
								setModal({ mode: 'edit', data: { ...blank, ...s, wp_app_password: '' } });
								setUrlError('');
								setLastMetadataUrl('');
							};
							return (
								<Card key={s.id} className="flex h-full flex-col">
									<div className="flex items-start justify-between gap-3">
										<div className="flex min-w-0 items-start gap-3">
											{s.favicon ? (
												<img src={s.favicon} alt={`${s.name} favicon`} loading="lazy" decoding="async" className="h-10 w-10 shrink-0 rounded-xl border border-border object-cover" />
											) : (
												<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Globe size={19} /></span>
											)}
											<div className="min-w-0">
												<h3 className="truncate font-semibold">{s.name}</h3>
												<a href={s.url} target="_blank" rel="noreferrer" className="block truncate text-sm text-muted-foreground hover:text-primary">{s.url || '—'}</a>
											</div>
										</div>
										<Badge tone={s.status === 'active' || s.status === 'connected' ? 'green' : s.status === 'failed' ? 'red' : 'default'}>{s.status || 'active'}</Badge>
									</div>

									<div className="mt-3 grid gap-3 sm:grid-cols-2">
										<Section title="Website Information">
											<p className="text-xs text-muted-foreground">Domain: {displayValue(siteInfo.domain || s.domain, 'Not available')}</p>
											<p className="text-xs text-muted-foreground">Created: {s.created || siteInfo.created ? formatDate(siteInfo.created || s.created) : 'Not available'}</p>
											<p className="text-xs text-muted-foreground">Last Scan: {formatRelative(siteInfo.lastScan || s.last_scan_at, 'Never synced')}</p>
											<p className="text-xs text-muted-foreground">Last Sync: {formatRelative(siteInfo.lastSync, 'Never synced')}</p>
											<p className="text-xs text-muted-foreground">WordPress Version: {displayValue(siteInfo.wordpressVersion || health.wpVersion, 'Not available')}</p>
											<p className="text-xs text-muted-foreground">PHP Version: {displayValue(siteInfo.phpVersion, 'Not available')}</p>
											<p className="text-xs text-muted-foreground">Theme: {displayValue(siteInfo.theme, 'Not available')}</p>
											<p className="text-xs text-muted-foreground">Active Plugins: {displayCount(siteInfo.activePluginsCount, 'Not available')}</p>
										</Section>

										<Section title="WordPress Status">
											<StatusLine ok={wordpress.connection?.status === 'connected'} label="Connected" missingLabel={wordpress.connection?.label || 'Not Connected'} />
											<StatusLine ok={wordpress.restApi?.status === 'ok'} label="REST API" missingLabel={wordpress.restApi?.label || 'REST API Missing'} />
											<StatusLine ok={wordpress.credentials?.status === 'configured'} label="Credentials Saved" missingLabel="Credentials Missing" />
											<StatusLine ok={wordpress.applicationPassword?.status === 'configured'} label="Application Password" missingLabel="Application Password Missing" />
											<p className="text-xs text-muted-foreground">Last Publish: {formatRelative(wordpress.lastPublishAt, 'Never synced')}</p>
											<p className="text-xs text-muted-foreground">Last Sync: {formatRelative(wordpress.lastSyncAt, 'Never synced')}</p>
											{wordpress.needsConfiguration ? (
												<>
													<p className="text-xs text-muted-foreground">{wordpress.configureHint || 'WordPress credentials are missing. Configure them in Website Settings.'}</p>
													<Button size="sm" variant="outline" onClick={openSettings}>Configure WordPress</Button>
												</>
											) : null}
										</Section>

										<Section title="Credentials Status">
											{(credentialsHealth.items || []).map((item) => (
												<p key={item.key} className="text-xs text-muted-foreground">
													{item.label}: <Badge tone={item.tone || statusTone(item.status)}>{item.labelStatus || (item.configured ? 'Configured' : 'Missing')}</Badge>
												</p>
											))}
											{(credentialsHealth.items || []).length === 0 ? (
												<p className="text-xs text-muted-foreground">Not available</p>
											) : null}
										</Section>

										<Section title="Publishing Health">
											{(publishingHealth.items || []).map((item) => (
												<StatusLine key={item.key} ok={item.ok} label={item.label} missingLabel={`${item.label} Missing`} />
											))}
											<p className="text-xs text-muted-foreground">
												Overall Score: {publishingHealth.overallScore != null ? `${publishingHealth.overallScore}%` : 'Not available'}
											</p>
										</Section>
									</div>

									<Section title="Recent Activity">
										{recentActivity.length === 0 ? (
											<p className="text-xs text-muted-foreground">Not available</p>
										) : (
											<div className="grid gap-1 sm:grid-cols-2">
												{recentActivity.map((event) => (
													<p key={event.id} className="text-xs text-muted-foreground">
														{event.title || event.type} · {formatRelative(event.at, 'Not available')}
													</p>
												))}
											</div>
										)}
									</Section>

									<div className="mt-auto flex flex-wrap gap-2 pt-4">
										<Button size="sm" onClick={() => navigate(`/app/websites/${s.id}`)}>Dashboard</Button>
										<Button size="sm" variant="outline" onClick={() => navigate(`/app/websites/${s.id}/articles`)}>Articles</Button>
										<Button size="sm" variant="outline" onClick={() => navigate(`/app/writer?websiteId=${s.id}`)}>AI Writer</Button>
										<Button size="sm" variant="outline" onClick={() => navigate(`/app/ai-pins?websiteId=${s.id}`)}>AI Pins</Button>
										<Button size="sm" variant="outline" onClick={() => navigate('/app/images')}>Image Generator</Button>
										<Button size="sm" variant="outline" onClick={() => test(s)} disabled={testing === s.id}>
											{testing === s.id ? <Spinner className="h-3.5 w-3.5" /> : <Plug size={14} />} Test Connection
										</Button>
										<Button size="sm" variant="ghost" onClick={openSettings}>Settings</Button>
										<Button size="sm" variant="ghost" onClick={() => remove(s)}><Trash2 size={14} className="text-destructive" /></Button>
									</div>
								</Card>
							);
						})}
					</div>
				</>
			)}

			{modal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModal(null)}>
					<Card className="w-full max-w-md">
						<div onClick={(e) => e.stopPropagation()}>
							<div className="mb-4 flex items-center justify-between">
								<h3 className="font-display text-lg font-semibold">{modal.mode === 'edit' ? 'Edit website' : 'Add website'}</h3>
								<button type="button" onClick={() => setModal(null)} aria-label="Close"><X size={18} /></button>
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

										await fetchWebsiteMetadata(trimmed, { allowFallback: true });
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
