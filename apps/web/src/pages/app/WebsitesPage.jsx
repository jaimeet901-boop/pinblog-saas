import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Globe, Plus, Trash2, Plug, X } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { notifyWebsitesChanged } from '@/lib/websites/websitesChanged';
import { writeStoredActiveWebsiteId } from '@/lib/websites/activeWebsite';
import {
	deriveWebsiteLifecycle,
	setWordPressSkipped,
} from '@/lib/websites/websiteLifecycle';
import { usePinterestConnected } from '@/hooks/usePinterestConnected';
import SetupProgressCard from '@/components/websites/SetupProgressCard';
import { buildFacebookStudioHref } from '@/lib/websites/facebookDashboardProgress';
import { Card, PageHeader, Button, Input, Badge, Empty, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import UpgradeModal from '@/components/billing/UpgradeModal';
import { isFeatureLockedError } from '@/lib/templateAccess';
import { resolveLockedFeatureIdentity } from '@/lib/lockedFeatureIdentity';

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

async function readErrorPayload(res, fallback) {
	try {
		const parsed = await res.json();
		if (parsed && typeof parsed === 'object') {
			return parsed;
		}
		return { message: fallback };
	} catch {
		return { message: fallback };
	}
}

async function readErrorMessage(res, fallback) {
	const parsed = await readErrorPayload(res, fallback);
	return parsed?.message || parsed?.error || fallback;
}

export default function WebsitesPage() {
	const { toast } = useToast();
	const navigate = useNavigate();
	const location = useLocation();
	const { pinterestConnected } = usePinterestConnected();
	const [sites, setSites] = useState([]);
	const [lifecycleTick, setLifecycleTick] = useState(0);
	const [workspaceIndicators, setWorkspaceIndicators] = useState(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState('');
	const [modal, setModal] = useState(null); // {mode, data}
	const [testing, setTesting] = useState(null);
	const [saving, setSaving] = useState(false);
	const [metadataLoading, setMetadataLoading] = useState(false);
	const [urlError, setUrlError] = useState('');
	const [lastMetadataUrl, setLastMetadataUrl] = useState('');
	const [upgradeModal, setUpgradeModal] = useState(null);

	const openFeatureLockedUpgradeModal = (error) => {
		const locked = {
			...(error && typeof error === 'object' ? error : {}),
			featureKey: error?.featureKey || 'websites',
		};
		const identity = resolveLockedFeatureIdentity(locked, {
			sourcePage: 'websites',
			requiredFeatureKeys: ['websites'],
		});
		const requiredFeatureKeys = Array.isArray(locked.requiredFeatureKeys) && locked.requiredFeatureKeys.length
			? locked.requiredFeatureKeys
			: (Array.isArray(locked.requiredKeys) && locked.requiredKeys.length
				? locked.requiredKeys
				: identity.requiredFeatureKeys);
		setUpgradeModal({
			templateId: identity.featureKey || 'websites',
			templateName: identity.label,
			access: locked.access || null,
			requiredFeatureKeys: requiredFeatureKeys.length ? requiredFeatureKeys : ['websites'],
			sourcePage: identity.sourcePage || 'websites',
		});
	};

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

	useEffect(() => {
		const targetId = location.state?.openWebsiteSettings;
		if (!targetId || loading || sites.length === 0) return;
		const site = sites.find((item) => item.id === targetId);
		if (!site) return;
		writeStoredActiveWebsiteId(site.id, { emit: true });
		setModal({ mode: 'edit', data: { ...blank, ...site, wp_app_password: '' } });
		setUrlError('');
		setLastMetadataUrl('');
		navigate(location.pathname, { replace: true, state: {} });
	}, [location.state, location.pathname, loading, sites, navigate]);

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
				const errorPayload = await readErrorPayload(res, `Failed to save website (${res.status})`);
				if (isFeatureLockedError(errorPayload)) {
					openFeatureLockedUpgradeModal(errorPayload);
					setModal(null);
					return;
				}
				throw new Error(errorPayload?.message || errorPayload?.error || `Failed to save website (${res.status})`);
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
				if (working.wp_username && working.wp_app_password) {
					setWordPressSkipped(savedSite.id, false);
				}
				toast({ title: 'Saved', description: working.wp_username ? 'WordPress updated. Next: scan your website.' : 'Website saved successfully.' });
				await load();
			} else {
				writeStoredActiveWebsiteId(savedSite.id, { emit: true });
				toast({ title: 'Website created', description: 'Setup started — connect WordPress or skip and scan.' });
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

			toast({
				variant: data.ok ? 'default' : 'destructive',
				title: data.ok ? 'Connected' : 'Connection failed',
				description: data.ok
					? `${data.message || 'WordPress connection OK.'} Next: scan your website.`
					: data.message,
			});
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
				title="Websites"
				subtitle="Your Website Hub — guided setup until first publish, then Operate Mode for production."
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
					subtitle="Add your first website to unlock scanning, articles, AI Pins, and publishing."
					action={<Button onClick={openNewModal}><Plus size={16} /> Add website</Button>}
				/>
			) : (
				<>
					<div className="grid gap-4 md:grid-cols-2">
						{sites.map((s) => {
							const siteInfo = s.control?.siteInfo || {};
							const lifecycle = deriveWebsiteLifecycle(s, { pinterestConnected });
							const isSetup = lifecycle.mode === 'setup' || lifecycle.step === 'analytics';
							const openSettings = () => {
								writeStoredActiveWebsiteId(s.id, { emit: true });
								setModal({ mode: 'edit', data: { ...blank, ...s, wp_app_password: '' } });
								setUrlError('');
								setLastMetadataUrl('');
							};
							const goPrimary = () => {
								writeStoredActiveWebsiteId(s.id, { emit: true });
								if (lifecycle.step === 'wordpress') {
									openSettings();
									return;
								}
								navigate(lifecycle.primaryHref);
							};
							const goSecondary = () => {
								if (lifecycle.secondaryAction === 'skip_wordpress') {
									setWordPressSkipped(s.id, true);
									setLifecycleTick((n) => n + 1);
									toast({
										title: 'WordPress skipped',
										description: 'You can connect later in Settings. Next: scan your website.',
									});
									writeStoredActiveWebsiteId(s.id, { emit: true });
									navigate(`/app/websites/${s.id}`);
									return;
								}
								if (lifecycle.secondaryAction === 'articles') {
									writeStoredActiveWebsiteId(s.id, { emit: true });
									navigate(`/app/websites/${s.id}/articles`);
								}
							};
							void lifecycleTick;
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
										<Badge tone={lifecycle.mode === 'setup' ? 'amber' : 'green'}>
											{lifecycle.mode === 'setup' ? 'Setup' : 'Operate'}
										</Badge>
									</div>

									{isSetup ? (
										<div className="mt-4">
											<SetupProgressCard
												lifecycle={lifecycle}
												onPrimary={goPrimary}
												onSecondary={lifecycle.secondaryLabel ? goSecondary : undefined}
											/>
										</div>
									) : (
										<div className="mt-4 rounded-xl border border-border bg-secondary/30 p-3">
											<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Operate</p>
											<p className="mt-1 text-sm">Production ready — scan, create pins, publish, and measure.</p>
											<div className="mt-3">
												<Button size="sm" onClick={goPrimary}>{lifecycle.primaryLabel}</Button>
											</div>
										</div>
									)}

									{lifecycle.mode === 'setup' ? (
										<div className="mt-3 space-y-2 text-xs text-muted-foreground">
											<p>Domain: {displayValue(siteInfo.domain || s.domain, 'Add a URL to continue')}</p>
											<p>
												WordPress:{' '}
												{lifecycle.wpConnected
													? 'Connected'
													: lifecycle.wpSkipped
														? 'Skipped for now'
														: 'Recommended for sync'}
											</p>
											<p>Last scan: {formatRelative(siteInfo.lastScan || s.last_scan_at, 'Not scanned yet')}</p>
										</div>
									) : (
										<div className="mt-3 grid gap-3 sm:grid-cols-2">
											<Section title="Status">
												<p className="text-xs text-muted-foreground">Last Scan: {formatRelative(siteInfo.lastScan || s.last_scan_at, 'Not scanned yet')}</p>
												<p className="text-xs text-muted-foreground">Articles ready: {lifecycle.hasArticles ? 'Yes' : 'Scan to discover'}</p>
												<StatusLine ok={lifecycle.wpConnected} label="WordPress connected" missingLabel="WordPress not connected" />
											</Section>
											<Section title="Recent activity">
												{(Array.isArray(s.control?.recentActivity) ? s.control.recentActivity : []).slice(0, 3).map((event) => (
													<p key={event.id} className="text-xs text-muted-foreground">
														{event.title || event.type} · {formatRelative(event.at, '—')}
													</p>
												))}
												{(s.control?.recentActivity || []).length === 0 ? (
													<p className="text-xs text-muted-foreground">No activity yet — create pins or publish to see history.</p>
												) : null}
											</Section>
										</div>
									)}

									<div className="mt-auto flex flex-wrap gap-2 pt-4">
										{lifecycle.mode === 'operate' ? (
											<Button size="sm" onClick={goPrimary}>{lifecycle.primaryLabel}</Button>
										) : null}
										{!isSetup || lifecycle.hasArticles ? (
											<Button size="sm" variant="outline" onClick={() => { writeStoredActiveWebsiteId(s.id, { emit: true }); navigate(`/app/websites/${s.id}/articles`); }}>Articles</Button>
										) : null}
										{lifecycle.hasArticles ? (
											<Button size="sm" variant="outline" onClick={() => { writeStoredActiveWebsiteId(s.id, { emit: true }); navigate(`/app/ai-pins?websiteId=${s.id}`); }}>AI Pins</Button>
										) : null}
										{lifecycle.hasArticles ? (
											<Button size="sm" variant="outline" onClick={() => { writeStoredActiveWebsiteId(s.id, { emit: true }); navigate(buildFacebookStudioHref(s.id)); }}>Create Facebook Post</Button>
										) : null}
										{lifecycle.mode === 'operate' ? (
											<>
												<Button size="sm" variant="outline" onClick={() => { writeStoredActiveWebsiteId(s.id, { emit: true }); navigate(`/app/writer?websiteId=${s.id}`); }}>AI Writer</Button>
												<Button size="sm" variant="outline" onClick={() => test(s)} disabled={testing === s.id}>
													{testing === s.id ? <Spinner className="h-3.5 w-3.5" /> : <Plug size={14} />} Test
												</Button>
											</>
										) : null}
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
			<UpgradeModal
				open={Boolean(upgradeModal)}
				onClose={() => setUpgradeModal(null)}
				templateId={upgradeModal?.templateId || 'websites'}
				templateName={upgradeModal?.templateName || 'Websites'}
				access={upgradeModal?.access || null}
				sourcePage={upgradeModal?.sourcePage || 'websites'}
				requiredFeatureKeys={upgradeModal?.requiredFeatureKeys || ['websites']}
			/>
		</div>
	);
}
