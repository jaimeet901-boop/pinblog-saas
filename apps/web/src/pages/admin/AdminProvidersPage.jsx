import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	Eye, Settings2, PlugZap, Power, PowerOff, X, Loader2, RefreshCw, Trash2,
} from 'lucide-react';
import { AdminHero, StatusPill, AdminSkeleton, AdminEmptyState, AdminErrorState } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

const CONFIG_FIELDS = [
	{ key: 'apiKey', label: 'API Key', type: 'password' },
	{ key: 'secretKey', label: 'Secret Key', type: 'password' },
	{ key: 'organizationId', label: 'Organization ID', type: 'text' },
	{ key: 'baseUrl', label: 'Base URL', type: 'text' },
	{ key: 'webhookUrl', label: 'Webhook URL', type: 'text' },
	{ key: 'redirectUri', label: 'Redirect URI', type: 'text' },
	{ key: 'scopes', label: 'Scopes', type: 'text' },
	{ key: 'timeout', label: 'Timeout', type: 'text' },
	{ key: 'retryPolicy', label: 'Retry Policy', type: 'text' },
	{ key: 'defaultModel', label: 'Default Model', type: 'text' },
];

function statusTone(status) {
	if (status === 'error') return 'failed';
	if (status === 'disconnected') return 'disconnected';
	return status;
}

function healthTone(health) {
	if (health === 'healthy') return 'healthy';
	if (health === 'degraded') return 'degraded';
	if (health === 'down') return 'failed';
	return 'ready';
}

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

export default function AdminProvidersPage() {
	const { toast } = useToast();
	const [providers, setProviders] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [saving, setSaving] = useState(false);
	const [selectedId, setSelectedId] = useState('');
	const [drawerMode, setDrawerMode] = useState('details');
	const [testProviderId, setTestProviderId] = useState('');
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState(null);
	const [draftConfig, setDraftConfig] = useState(null);

	const selected = providers.find((item) => item.id === selectedId) || null;
	const testingProvider = providers.find((item) => item.id === testProviderId) || null;

	const stats = useMemo(() => {
		const total = providers.length;
		const connected = providers.filter((item) => item.status === 'connected').length;
		const disconnected = providers.filter((item) => item.status === 'disconnected').length;
		const errors = providers.filter((item) => item.status === 'error').length;
		return { total, connected, disconnected, errors };
	}, [providers]);

	const upsertLocal = useCallback((provider) => {
		setProviders((prev) => {
			const index = prev.findIndex((item) => item.id === provider.id);
			if (index === -1) return [...prev, provider];
			const next = [...prev];
			next[index] = provider;
			return next;
		});
	}, []);

	const loadProviders = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const response = await apiServerClient.fetch('/admin/v1/providers');
			if (!response.ok) {
				throw new Error(await readApiError(response));
			}
			const data = await response.json();
			setProviders(Array.isArray(data.items) ? data.items : []);
		} catch (err) {
			setError(err?.message || 'Failed to load providers');
			setProviders([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadProviders();
	}, [loadProviders]);

	useEffect(() => {
		if (selected) {
			setDraftConfig({ ...(selected.config || {}) });
		} else {
			setDraftConfig(null);
		}
	}, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset draft when selection changes

	useEffect(() => {
		if (!selected && !testingProvider) return undefined;
		const onKeyDown = (event) => {
			if (event.key === 'Escape') {
				setSelectedId('');
				setTestProviderId('');
				setTestResult(null);
				setTesting(false);
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [selected, testingProvider]);

	const openDetails = (id) => {
		setSelectedId(id);
		setDrawerMode('details');
	};

	const openConfigure = (id) => {
		setSelectedId(id);
		setDrawerMode('configure');
	};

	const openTest = (id) => {
		setTestProviderId(id);
		setTestResult(null);
		setTesting(false);
	};

	const runTest = async () => {
		if (!testingProvider) return;
		setTesting(true);
		setTestResult(null);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/providers/${testingProvider.id}/test`, {
				method: 'POST',
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(data?.message || await readApiError(response));
			}
			if (data.provider) upsertLocal(data.provider);
			setTestResult({
				ok: Boolean(data.ok),
				message: data.message || (data.ok ? 'Connection successful' : 'Connection failed'),
				checkedAt: data.checkedAt || new Date().toISOString().replace('T', ' ').slice(0, 16),
			});
			toast({
				title: data.ok ? 'Connection healthy' : 'Connection failed',
				description: data.message,
				variant: data.ok ? 'default' : 'destructive',
			});
		} catch (err) {
			setTestResult({
				ok: false,
				message: err?.message || 'Test failed',
				checkedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
			});
			toast({ variant: 'destructive', title: 'Test failed', description: err?.message });
		} finally {
			setTesting(false);
		}
	};

	const toggleEnabled = async (id, enabled) => {
		try {
			const response = await apiServerClient.fetch(`/admin/v1/providers/${id}/${enabled ? 'enable' : 'disable'}`, {
				method: 'POST',
			});
			if (!response.ok) {
				throw new Error(await readApiError(response));
			}
			const provider = await response.json();
			upsertLocal(provider);
			toast({
				title: enabled ? 'Provider enabled' : 'Provider disabled',
				description: provider.name,
			});
		} catch (err) {
			toast({ variant: 'destructive', title: 'Update failed', description: err?.message });
		}
	};

	const updateConfigField = (key, value) => {
		setDraftConfig((prev) => ({ ...(prev || {}), [key]: value }));
	};

	const saveConfiguration = async () => {
		if (!selectedId || !draftConfig) return;
		setSaving(true);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/providers/${selectedId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ config: draftConfig }),
			});
			if (!response.ok) {
				throw new Error(await readApiError(response));
			}
			const provider = await response.json();
			upsertLocal(provider);
			setDraftConfig({ ...(provider.config || {}) });
			toast({ title: 'Configuration saved', description: provider.name });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Save failed', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	const removeProvider = async () => {
		if (!selectedId || !selected) return;
		if (!window.confirm(`Delete provider "${selected.name}"? Built-in catalog providers cannot be deleted.`)) {
			return;
		}
		try {
			const response = await apiServerClient.fetch(`/admin/v1/providers/${selectedId}`, {
				method: 'DELETE',
			});
			if (!response.ok) {
				throw new Error(await readApiError(response));
			}
			setProviders((prev) => prev.filter((item) => item.id !== selectedId));
			setSelectedId('');
			toast({ title: 'Provider deleted', description: selected.name });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Delete failed', description: err?.message });
		}
	};

	return (
		<div>
			<AdminHero
				title="AI & Platform Providers"
				description="Configure all platform-wide AI providers and external integrations. Admin-only — secrets never appear in the customer workspace."
				action={(
					<button type="button" className="admin-btn" onClick={loadProviders} disabled={loading}>
						<RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Reload
					</button>
				)}
			/>

			<div className="admin-stats admin-stats--compact">
				{[
					{ label: 'Total Providers', value: stats.total },
					{ label: 'Connected Providers', value: stats.connected },
					{ label: 'Disconnected Providers', value: stats.disconnected },
					{ label: 'Providers with Errors', value: stats.errors },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
						<p className="admin-stat__hint">Live</p>
					</div>
				))}
			</div>

			{loading ? (
				<section className="admin-card">
					<AdminSkeleton rows={6} />
				</section>
			) : null}

			{!loading && error ? (
				<section className="admin-card">
					<AdminErrorState title="Unable to load providers" description={error} />
					<div className="mt-3">
						<button type="button" className="admin-btn admin-btn--primary" onClick={loadProviders}>
							Retry
						</button>
					</div>
				</section>
			) : null}

			{!loading && !error && providers.length === 0 ? (
				<section className="admin-card">
					<AdminEmptyState title="No providers" description="Provider catalog is empty. Reload to seed defaults." />
				</section>
			) : null}

			{!loading && !error && providers.length > 0 ? (
				<div className="admin-provider-grid">
					{providers.map((provider) => (
						<article key={provider.id} className="admin-provider">
							<div className="admin-provider__top">
								<span className={`admin-provider__logo bg-gradient-to-br ${provider.accent}`}>{provider.badge}</span>
								<div className="min-w-0 flex-1">
									<div className="flex items-start justify-between gap-2">
										<h4>{provider.name}</h4>
										<StatusPill status={statusTone(provider.status)} />
									</div>
									<p className="mt-1 text-[11px]" style={{ color: 'var(--admin-muted)' }}>
										{provider.enabled ? 'Enabled' : 'Disabled'} · platform secrets masked
									</p>
								</div>
							</div>

							<div className="admin-provider__meta">
								<div>Status · <strong>{provider.status}</strong></div>
								<div>Last Checked · <strong>{provider.lastChecked}</strong></div>
								<div>Current Model · <strong>{provider.currentModel}</strong></div>
								<div className="flex items-center gap-2">
									Connection Health
									<StatusPill status={healthTone(provider.health)} />
								</div>
							</div>

							<div className="admin-provider__actions">
								<button type="button" className="admin-btn" onClick={() => openDetails(provider.id)}>
									<Eye size={12} /> View Details
								</button>
								<button type="button" className="admin-btn admin-btn--primary" onClick={() => openConfigure(provider.id)}>
									<Settings2 size={12} /> Configure
								</button>
								<button type="button" className="admin-btn" onClick={() => openTest(provider.id)}>
									<PlugZap size={12} /> Test Connection
								</button>
								<button
									type="button"
									className="admin-btn"
									onClick={() => toggleEnabled(provider.id, true)}
									disabled={provider.enabled}
								>
									<Power size={12} /> Enable
								</button>
								<button
									type="button"
									className="admin-btn"
									onClick={() => toggleEnabled(provider.id, false)}
									disabled={!provider.enabled}
								>
									<PowerOff size={12} /> Disable
								</button>
							</div>
						</article>
					))}
				</div>
			) : null}

			<p className="admin-note">
				API keys are encrypted at rest and always masked in the Admin Console. Workspace apps never receive these secrets.
			</p>

			{selected && draftConfig ? (
				<div className="admin-drawer-overlay" role="dialog" aria-modal="true" aria-label="Provider details" onClick={() => setSelectedId('')}>
					<aside className="admin-user-drawer admin-user-drawer--wide" onClick={(event) => event.stopPropagation()}>
						<div className="admin-user-drawer__head">
							<div className="flex items-center gap-3">
								<span className={`admin-provider__logo bg-gradient-to-br ${selected.accent}`}>{selected.badge}</span>
								<div>
									<p className="font-display text-xl font-semibold leading-tight">{selected.name}</p>
									<div className="mt-2 flex flex-wrap gap-2">
										<StatusPill status={statusTone(selected.status)} />
										<StatusPill status={healthTone(selected.health)} />
									</div>
								</div>
							</div>
							<button type="button" className="admin-icon-btn" onClick={() => setSelectedId('')} aria-label="Close">
								<X size={16} />
							</button>
						</div>

						<div className="mb-3 flex flex-wrap gap-2">
							<button type="button" className={`admin-btn ${drawerMode === 'details' ? 'admin-btn--primary' : ''}`} onClick={() => setDrawerMode('details')}>
								Details
							</button>
							<button type="button" className={`admin-btn ${drawerMode === 'configure' ? 'admin-btn--primary' : ''}`} onClick={() => setDrawerMode('configure')}>
								Configuration
							</button>
						</div>

						{drawerMode === 'details' ? (
							<>
								<section className="admin-user-drawer__section">
									<h3>Provider Information</h3>
									<div className="admin-meta-row"><span>Name</span><span>{selected.name}</span></div>
									<div className="admin-meta-row"><span>Code</span><span>{selected.code}</span></div>
									<div className="admin-meta-row"><span>Status</span><StatusPill status={statusTone(selected.status)} /></div>
									<div className="admin-meta-row"><span>Enabled</span><span>{selected.enabled ? 'Yes' : 'No'}</span></div>
									<div className="admin-meta-row"><span>Current model</span><span>{selected.currentModel}</span></div>
									<div className="admin-meta-row"><span>Priority</span><span>{selected.priority}</span></div>
								</section>

								<section className="admin-user-drawer__section">
									<h3>API Endpoint</h3>
									<p className="text-sm" style={{ color: 'var(--admin-muted)', wordBreak: 'break-all' }}>{selected.endpoint}</p>
								</section>

								<section className="admin-user-drawer__section">
									<h3>Supported Models</h3>
									<div className="flex flex-wrap gap-2">
										{(selected.models || []).map((model) => (
											<span key={model} className="admin-pill">{model}</span>
										))}
									</div>
								</section>

								<section className="admin-user-drawer__section">
									<h3>Limits & Version</h3>
									<div className="admin-meta-row"><span>Rate Limits</span><span>{selected.rateLimit}</span></div>
									<div className="admin-meta-row"><span>API Version</span><span>{selected.apiVersion}</span></div>
									<div className="admin-meta-row"><span>Last Successful Request</span><span>{selected.lastSuccess}</span></div>
									<div className="admin-meta-row"><span>Last Error</span><span>{selected.lastError}</span></div>
									<div className="admin-meta-row"><span>Last Latency</span><span>{selected.lastLatencyMs != null ? `${selected.lastLatencyMs}ms` : '—'}</span></div>
								</section>

								<section className="admin-user-drawer__section">
									<h3>Configuration History</h3>
									<div className="admin-list">
										{(selected.history || []).length === 0 ? (
											<AdminEmptyState title="No history yet" description="Configuration and health events will appear here." />
										) : (
											(selected.history || []).map((item) => (
												<div key={`${item.text}-${item.time}`} className="admin-list__item">
													<span>{item.text}</span>
													<span>{item.time}</span>
												</div>
											))
										)}
									</div>
								</section>
							</>
						) : (
							<section className="admin-user-drawer__section">
								<h3>Configuration Form</h3>
								<p className="admin-note mt-0 mb-3">Leave masked secret fields unchanged to keep existing keys. New values are encrypted before storage.</p>
								<div className="admin-config-grid">
									{CONFIG_FIELDS.map((field) => (
										<div key={field.key} className="admin-field">
											<label htmlFor={`${selected.id}-${field.key}`}>{field.label}</label>
											<input
												id={`${selected.id}-${field.key}`}
												type={field.type}
												value={draftConfig?.[field.key] || ''}
												onChange={(e) => updateConfigField(field.key, e.target.value)}
												placeholder={`Enter ${field.label.toLowerCase()}`}
												autoComplete="off"
											/>
										</div>
									))}
								</div>
								<div className="mt-3 flex flex-wrap gap-2">
									<button type="button" className="admin-btn admin-btn--primary" onClick={saveConfiguration} disabled={saving}>
										{saving ? <Loader2 size={12} className="animate-spin" /> : null}
										{saving ? 'Saving…' : 'Save configuration'}
									</button>
									<button type="button" className="admin-btn" onClick={() => openTest(selected.id)}>
										<PlugZap size={12} /> Test Connection
									</button>
									<button type="button" className="admin-btn admin-btn--danger" onClick={removeProvider}>
										<Trash2 size={12} /> Delete
									</button>
								</div>
							</section>
						)}
					</aside>
				</div>
			) : null}

			{testingProvider ? (
				<div className="admin-modal-overlay" role="dialog" aria-modal="true" aria-label="Test connection" onClick={() => { setTestProviderId(''); setTestResult(null); }}>
					<div className="admin-modal" onClick={(event) => event.stopPropagation()}>
						<div className="flex items-start justify-between gap-3">
							<div>
								<h2>Test Connection</h2>
								<p className="mt-1 text-sm" style={{ color: 'var(--admin-muted)' }}>
									Live probe for {testingProvider.name}. Credentials stay on the server.
								</p>
							</div>
							<button type="button" className="admin-icon-btn" onClick={() => { setTestProviderId(''); setTestResult(null); }} aria-label="Close">
								<X size={16} />
							</button>
						</div>

						{testResult ? (
							<div className="admin-modal__result">
								<div className="mb-2"><StatusPill status={testResult.ok ? 'healthy' : 'failed'} /></div>
								<p>{testResult.message}</p>
								<p className="mt-2" style={{ color: 'var(--admin-muted)' }}>Checked at {testResult.checkedAt}</p>
							</div>
						) : (
							<div className="admin-modal__result">
								Ready to run a live health check against the configured endpoint.
							</div>
						)}

						<div className="admin-modal__actions">
							<button type="button" className="admin-btn" onClick={() => { setTestProviderId(''); setTestResult(null); }}>
								Close
							</button>
							<button type="button" className="admin-btn admin-btn--primary" onClick={runTest} disabled={testing}>
								{testing ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
								{testing ? 'Testing…' : 'Run health check'}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
