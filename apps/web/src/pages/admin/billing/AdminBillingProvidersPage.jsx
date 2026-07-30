import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	RefreshCw, Settings2, PlugZap, Power, ShieldCheck, X,
} from 'lucide-react';
import { AdminEmptyState, AdminErrorState, AdminHero, AdminSkeleton, StatusPill } from '@/components/admin/AdminUi';
import { apiServerClient } from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

const MASK = '••••••••••••';

const PROVIDER_FIELDS = {
	stripe: [
		{ key: 'mode', label: 'Environment', type: 'select', options: [
			{ value: 'test', label: 'Test / Sandbox' },
			{ value: 'live', label: 'Live / Production' },
		] },
		{ key: 'enabled', label: 'Enabled', type: 'toggle' },
		{ key: 'publishableKey', label: 'Publishable Key', type: 'text' },
		{ key: 'secretKey', label: 'Secret Key', type: 'password', secret: true, setKey: 'secretKeySet' },
		{ key: 'webhookSecret', label: 'Webhook Secret', type: 'password', secret: true, setKey: 'webhookSecretSet' },
	],
	paddle: [
		{ key: 'mode', label: 'Environment', type: 'select', options: [
			{ value: 'test', label: 'Test / Sandbox' },
			{ value: 'live', label: 'Live / Production' },
		] },
		{ key: 'enabled', label: 'Enabled', type: 'toggle' },
						{ key: 'sandbox', label: 'Paddle Sandbox API', type: 'toggle' },
		{ key: 'vendorId', label: 'Vendor ID', type: 'text' },
		{ key: 'defaultPriceId', label: 'Default Price ID', type: 'text' },
		{ key: 'apiKey', label: 'API Key', type: 'password', secret: true, setKey: 'apiKeySet' },
		{ key: 'webhookSecret', label: 'Webhook Secret', type: 'password', secret: true, setKey: 'webhookSecretSet' },
	],
	lemonsqueezy: [
		{ key: 'mode', label: 'Environment', type: 'select', options: [
			{ value: 'test', label: 'Test / Sandbox' },
			{ value: 'live', label: 'Live / Production' },
		] },
		{ key: 'enabled', label: 'Enabled', type: 'toggle' },
		{ key: 'storeId', label: 'Store ID', type: 'text' },
		{ key: 'defaultVariantId', label: 'Default Variant ID', type: 'text' },
		{ key: 'apiKey', label: 'API Key', type: 'password', secret: true, setKey: 'apiKeySet' },
		{ key: 'webhookSecret', label: 'Webhook Secret', type: 'password', secret: true, setKey: 'webhookSecretSet' },
	],
};

async function readApiError(response) {
	const payload = await response.json().catch(() => ({}));
	return payload?.error || payload?.message || `Request failed (${response.status})`;
}

function healthTone(status) {
	const value = String(status || '').toLowerCase();
	if (value === 'healthy') return 'healthy';
	if (value === 'warning') return 'warning';
	if (value === 'critical' || value === 'offline') return 'critical';
	if (value === 'configured') return 'connected';
	return 'pending';
}

function buildDraft(provider) {
	const config = provider?.config || {};
	const fields = PROVIDER_FIELDS[provider?.code] || [];
	const draft = {
		mode: config.mode || provider.environment || 'test',
		enabled: config.enabled !== false,
	};
	for (const field of fields) {
		if (field.secret) {
			draft[field.key] = config[field.setKey] ? MASK : '';
		} else if (field.type === 'toggle') {
			draft[field.key] = Boolean(config[field.key] ?? draft[field.key]);
		} else if (field.key !== 'mode' && field.key !== 'enabled') {
			draft[field.key] = config[field.key] || '';
		}
	}
	return draft;
}

export default function AdminBillingProvidersPage() {
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [items, setItems] = useState([]);
	const [checkoutEnabled, setCheckoutEnabled] = useState(false);
	const [updatedAt, setUpdatedAt] = useState(null);
	const [selectedCode, setSelectedCode] = useState('');
	const [draft, setDraft] = useState(null);
	const [permissions, setPermissions] = useState({});

	const selected = useMemo(
		() => items.find((item) => item.code === selectedCode) || null,
		[items, selectedCode],
	);

	const canManage = permissions['admin.billing.manage'] !== false;
	const canWriteSecrets = permissions['admin.billing.secrets.write'] !== false;

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/providers');
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setItems(payload.items || []);
			setCheckoutEnabled(Boolean(payload.checkoutEnabled));
			setUpdatedAt(payload.updatedAt || null);
			setPermissions(payload.permissions || {});
		} catch (err) {
			setError(err?.message || 'Unable to load billing providers');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const openConfigure = (code) => {
		const provider = items.find((item) => item.code === code);
		if (!provider?.configurable) return;
		setSelectedCode(code);
		setDraft(buildDraft(provider));
	};

	const closeDrawer = () => {
		setSelectedCode('');
		setDraft(null);
	};

	const upsertLocal = (provider) => {
		setItems((prev) => prev.map((item) => (
			item.code === provider.code
				? { ...item, ...provider, active: provider.active, config: provider.config }
				: (provider.active ? { ...item, active: false } : item)
		)));
	};

	const saveConfig = async () => {
		if (!selected || !draft || !canManage) return;
		setSaving(true);
		try {
			const body = { expectedUpdatedAt: updatedAt };
			const fields = PROVIDER_FIELDS[selected.code] || [];
			for (const field of fields) {
				if (field.secret) {
					if (!canWriteSecrets) continue;
					const value = draft[field.key];
					if (value && value !== MASK && !String(value).includes('•')) {
						body[field.key] = value;
					}
				} else {
					body[field.key] = draft[field.key];
				}
			}
			const response = await apiServerClient.fetch(`/admin/v1/billing/control-plane/providers/${selected.code}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const provider = await response.json();
			upsertLocal(provider);
			setUpdatedAt(provider.updatedAt || updatedAt);
			setDraft(buildDraft(provider));
			toast({ title: 'Provider saved', description: provider.name });
			await load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Save failed', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	const activate = async (code) => {
		if (!canManage) return;
		try {
			const response = await apiServerClient.fetch(`/admin/v1/billing/control-plane/providers/${code}/activate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ expectedUpdatedAt: updatedAt }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const provider = await response.json();
			toast({ title: 'Provider activated', description: provider.name });
			await load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Activate failed', description: err?.message });
		}
	};

	const toggleEnabled = async (code, enabled) => {
		if (!canManage) return;
		try {
			const response = await apiServerClient.fetch(
				`/admin/v1/billing/control-plane/providers/${code}/${enabled ? 'enable' : 'disable'}`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ expectedUpdatedAt: updatedAt }),
				},
			);
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: enabled ? 'Provider enabled' : 'Provider disabled' });
			await load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Update failed', description: err?.message });
		}
	};

	const toggleCheckout = async (value) => {
		if (!canManage) return;
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ checkoutEnabled: value, expectedUpdatedAt: updatedAt }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setCheckoutEnabled(Boolean(payload.checkoutEnabled));
			setUpdatedAt(payload.updatedAt || updatedAt);
			toast({ title: value ? 'Checkout enabled' : 'Checkout disabled' });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Checkout update failed', description: err?.message });
		}
	};

	const stats = useMemo(() => ({
		total: items.length,
		connected: items.filter((item) => item.connected).length,
		active: items.filter((item) => item.active).length,
		enabled: items.filter((item) => item.enabled).length,
	}), [items]);

	return (
		<div>
			<AdminHero
				title="Billing Providers"
				description="Configure owner merchant credentials for Stripe, Paddle, and Lemon Squeezy. Secrets are encrypted at rest and never returned to the browser."
				action={(
					<div className="flex flex-wrap gap-2">
						<Link to="/admin/billing/logs" className="admin-btn">Billing Logs</Link>
						<button type="button" className="admin-btn" onClick={load} disabled={loading}>
							<RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Reload
						</button>
					</div>
				)}
			/>

			<section className="admin-card mb-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<p className="admin-stat__label">Checkout</p>
						<p style={{ fontSize: 14 }}>
							{checkoutEnabled ? 'Enabled' : 'Disabled'}
							{' · '}
							managed only from Billing Providers (Single Write Authority)
						</p>
					</div>
					<button
						type="button"
						className={`admin-btn ${checkoutEnabled ? '' : 'admin-btn--primary'}`}
						disabled={!canManage}
						onClick={() => toggleCheckout(!checkoutEnabled)}
					>
						{checkoutEnabled ? 'Disable Checkout' : 'Enable Checkout'}
					</button>
				</div>
			</section>

			<div className="admin-stats admin-stats--compact">
				{[
					{ label: 'Providers', value: stats.total },
					{ label: 'Connected', value: stats.connected },
					{ label: 'Enabled', value: stats.enabled },
					{ label: 'Active', value: stats.active },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
					</div>
				))}
			</div>

			{loading ? (
				<section className="admin-card"><AdminSkeleton rows={6} /></section>
			) : null}

			{!loading && error ? (
				<section className="admin-card">
					<AdminErrorState title="Unable to load billing providers" description={error} />
					<button type="button" className="admin-btn admin-btn--primary mt-3" onClick={load}>Retry</button>
				</section>
			) : null}

			{!loading && !error && items.length === 0 ? (
				<section className="admin-card">
					<AdminEmptyState title="No providers" description="Billing provider catalog is empty." />
				</section>
			) : null}

			{!loading && !error && items.length > 0 ? (
				<div className="admin-provider-grid">
					{items.map((provider) => (
						<article key={provider.code} className="admin-provider">
							<div className="admin-provider__top">
								<span className="admin-provider__logo bg-gradient-to-br from-slate-700 to-slate-900">
									{(provider.name || '?').slice(0, 2).toUpperCase()}
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex items-start justify-between gap-2">
										<h4>{provider.name}</h4>
										<StatusPill status={provider.active ? 'active' : (provider.connected ? 'connected' : 'pending')} />
									</div>
									<p className="mt-1 text-[11px]" style={{ color: 'var(--admin-muted)' }}>
										{provider.enabled ? 'Enabled' : 'Disabled'}
										{' · '}
										{provider.configurable ? 'Configurable' : 'Coming soon'}
									</p>
								</div>
							</div>

							<div className="admin-provider__meta">
								<div>Enabled · <strong>{provider.enabled ? 'Yes' : 'No'}</strong></div>
								<div>Active · <strong>{provider.active ? 'Yes' : 'No'}</strong></div>
								<div>Environment · <strong>{provider.environment || '—'}</strong></div>
								<div>Connected · <strong>{provider.connectionLabel || (provider.connected ? 'Connected' : 'Not connected')}</strong></div>
								<div className="flex items-center gap-2">
									Health <StatusPill status={healthTone(provider.status || provider.healthLabel)} />
									<span style={{ fontSize: 12 }}>
										{provider.status || provider.healthLabel || 'Unknown'}
										{provider.healthScore != null ? ` · ${provider.healthScore}` : ''}
									</span>
								</div>
								<div>Last Health Check · <strong>{provider.lastHealthCheck || '—'}</strong></div>
							</div>

							<div className="admin-provider__actions">
								<button
									type="button"
									className="admin-btn admin-btn--primary"
									disabled={!provider.configurable || !canManage}
									onClick={() => openConfigure(provider.code)}
								>
									<Settings2 size={12} /> Configure
								</button>
								<button type="button" className="admin-btn" disabled title="Connection test arrives in a later phase">
									<PlugZap size={12} /> Test Connection
								</button>
								<button
									type="button"
									className="admin-btn"
									disabled={!provider.configurable || !canManage || provider.active || !provider.connected}
									onClick={() => activate(provider.code)}
								>
									<ShieldCheck size={12} /> Activate
								</button>
								{provider.configurable ? (
									<button
										type="button"
										className="admin-btn"
										disabled={!canManage}
										onClick={() => toggleEnabled(provider.code, !provider.enabled)}
									>
										<Power size={12} /> {provider.enabled ? 'Disable' : 'Enable'}
									</button>
								) : null}
							</div>
						</article>
					))}
				</div>
			) : null}

			<p className="admin-note">
				Secrets are encrypted with the existing platform secret crypto. APIs return only Configured / Not Configured flags — never plaintext keys.
			</p>

			{selected && draft ? (
				<div className="admin-drawer-overlay" role="presentation" onClick={closeDrawer}>
					<aside
						className="admin-user-drawer admin-user-drawer--wide"
						role="dialog"
						aria-label={`Configure ${selected.name}`}
						onClick={(event) => event.stopPropagation()}
					>
						<div className="flex items-start justify-between gap-3">
							<div>
								<h3>{selected.name}</h3>
								<p className="admin-note mt-1 mb-0">Leave masked secrets unchanged to keep existing values.</p>
							</div>
							<button type="button" className="admin-btn" onClick={closeDrawer} aria-label="Close">
								<X size={14} />
							</button>
						</div>

						<div className="mt-4 space-y-3">
							{(PROVIDER_FIELDS[selected.code] || []).map((field) => {
								if (field.type === 'toggle') {
									return (
										<label key={field.key} className="admin-field flex items-center justify-between gap-3">
											<span>{field.label}</span>
											<input
												type="checkbox"
												checked={Boolean(draft[field.key])}
												disabled={!canManage}
												onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.checked }))}
											/>
										</label>
									);
								}
								if (field.type === 'select') {
									return (
										<label key={field.key} className="admin-field">
											<span>{field.label}</span>
											<select
												value={draft[field.key] || 'test'}
												disabled={!canManage}
												onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
											>
												{field.options.map((option) => (
													<option key={option.value} value={option.value}>{option.label}</option>
												))}
											</select>
										</label>
									);
								}
								const configured = field.secret
									? Boolean(selected.config?.[field.setKey])
									: Boolean(String(draft[field.key] || '').trim());
								return (
									<label key={field.key} className="admin-field">
										<span>
											{field.label}
											{field.secret ? (
												<span style={{ color: 'var(--admin-muted)', marginLeft: 8 }}>
													{configured ? 'Configured' : 'Not Configured'}
												</span>
											) : null}
										</span>
										<input
											type={field.type === 'password' ? 'password' : 'text'}
											value={draft[field.key] || ''}
											disabled={!canManage || (field.secret && !canWriteSecrets)}
											placeholder={field.secret ? (configured ? MASK : 'Enter secret') : ''}
											onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
											onFocus={() => {
												if (field.secret && draft[field.key] === MASK) {
													setDraft((prev) => ({ ...prev, [field.key]: '' }));
												}
											}}
											autoComplete="off"
										/>
									</label>
								);
							})}
						</div>

						<div className="mt-5 flex flex-wrap gap-2">
							<button type="button" className="admin-btn admin-btn--primary" disabled={saving || !canManage} onClick={saveConfig}>
								{saving ? 'Saving…' : 'Save configuration'}
							</button>
							<button type="button" className="admin-btn" onClick={closeDrawer}>Cancel</button>
						</div>
					</aside>
				</div>
			) : null}
		</div>
	);
}
