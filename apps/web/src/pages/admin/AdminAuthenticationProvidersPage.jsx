import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Loader2, PlugZap, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react';
import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

function emptyForm(provider) {
	return {
		clientId: provider?.clientId || provider?.placeholders?.clientId || '',
		clientSecret: '',
		redirectUri: provider?.redirectUri || provider?.canonicalRedirectUri || provider?.placeholders?.redirectUri || '',
		scopes: provider?.scopes || provider?.placeholders?.scopes || '',
		enabled: Boolean(provider?.enabled),
	};
}

function pillToneForStatus(status) {
	switch (status) {
		case 'connected':
		case 'database_configuration':
			return 'healthy';
		case 'environment_fallback':
			return 'configured';
		case 'disabled':
			return 'degraded';
		case 'invalid_credentials':
			return 'failed';
		case 'not_configured':
		default:
			return 'pending';
	}
}

export default function AdminAuthenticationProvidersPage() {
	const { toast } = useToast();
	const [items, setItems] = useState([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState('');
	const [forms, setForms] = useState({});
	const [selectedId, setSelectedId] = useState('google');

	const applyProvider = useCallback((payload) => {
		setItems((prev) => {
			const exists = prev.some((item) => item.id === payload.id);
			if (!exists) return [...prev, payload];
			return prev.map((item) => (item.id === payload.id ? payload : item));
		});
		setForms((prev) => ({ ...prev, [payload.id]: emptyForm(payload) }));
	}, []);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/authentication-providers');
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			const list = Array.isArray(payload.items) ? payload.items : [];
			setItems(list);
			setForms((prev) => {
				const next = { ...prev };
				for (const provider of list) {
					next[provider.id] = emptyForm(provider);
				}
				return next;
			});
			setSelectedId((current) => (
				list.some((item) => item.id === current) ? current : (list[0]?.id || 'google')
			));
		} catch (error) {
			toast({ variant: 'destructive', title: 'Authentication providers failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [toast]);

	useEffect(() => {
		load();
	}, [load]);

	const selected = items.find((item) => item.id === selectedId) || null;
	const form = forms[selectedId] || emptyForm(selected);

	const updateForm = (patch) => {
		setForms((prev) => ({
			...prev,
			[selectedId]: { ...emptyForm(selected), ...(prev[selectedId] || {}), ...patch },
		}));
	};

	const copyRedirectUri = async () => {
		const value = String(form.redirectUri || selected?.canonicalRedirectUri || '').trim();
		if (!value) {
			toast({ variant: 'destructive', title: 'Nothing to copy', description: 'Redirect URI is empty.' });
			return;
		}
		try {
			await navigator.clipboard.writeText(value);
			toast({ title: 'Redirect URI copied', description: value });
		} catch {
			toast({ variant: 'destructive', title: 'Copy failed', description: 'Clipboard access was blocked.' });
		}
	};

	const save = async (event) => {
		event.preventDefault();
		if (!selected?.configurable) return;
		setBusy('save');
		try {
			const body = {
				clientId: String(form.clientId || '').trim(),
				redirectUri: String(form.redirectUri || '').trim(),
				scopes: String(form.scopes || '').trim(),
				enabled: Boolean(form.enabled),
			};
			if (String(form.clientSecret || '').trim() && !String(form.clientSecret).includes('•')) {
				body.clientSecret = String(form.clientSecret).trim();
			}
			const response = await apiServerClient.fetch(`/admin/v1/authentication-providers/${selected.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			applyProvider(payload);
			toast({
				title: `${payload.displayName} saved`,
				description: 'Credentials encrypted. PocketBase login providers refreshed. Secret remains masked.',
			});
		} catch (error) {
			toast({ variant: 'destructive', title: 'Save failed', description: error.message });
		} finally {
			setBusy('');
		}
	};

	const testConnection = async () => {
		if (!selected?.configurable) return;
		setBusy('test');
		try {
			const body = {
				clientId: String(form.clientId || '').trim(),
				redirectUri: String(form.redirectUri || '').trim(),
			};
			if (String(form.clientSecret || '').trim() && !String(form.clientSecret).includes('•')) {
				body.clientSecret = String(form.clientSecret).trim();
			}
			const response = await apiServerClient.fetch(`/admin/v1/authentication-providers/${selected.id}/test`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(payload.message || await readApiError(response));
			if (payload.provider) applyProvider(payload.provider);
			toast({
				variant: payload.ok ? 'default' : 'destructive',
				title: payload.ok ? 'Connection OK' : 'Connection failed',
				description: payload.message || (payload.ok ? 'Credentials look valid.' : 'Credentials were rejected.'),
			});
		} catch (error) {
			toast({ variant: 'destructive', title: 'Test failed', description: error.message });
		} finally {
			setBusy('');
		}
	};

	const rotateSecret = async () => {
		if (!selected?.configurable) return;
		const nextSecret = String(form.clientSecret || '').trim();
		if (!nextSecret || nextSecret.includes('•')) {
			toast({
				variant: 'destructive',
				title: 'Secret required',
				description: 'Paste a new Client Secret in the field, then click Rotate Secret.',
			});
			return;
		}
		if (!window.confirm(`Rotate the ${selected.displayName} Client Secret?\n\nThe previous secret will be replaced in encrypted storage. Login will use the new secret after PocketBase refresh.`)) {
			return;
		}
		setBusy('rotate');
		try {
			const response = await apiServerClient.fetch(`/admin/v1/authentication-providers/${selected.id}/rotate-secret`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientSecret: nextSecret }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			applyProvider(payload);
			toast({ title: 'Secret rotated', description: `${payload.displayName} secret updated and masked.` });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Rotate failed', description: error.message });
		} finally {
			setBusy('');
		}
	};

	const resetCredentials = async () => {
		if (!selected?.configurable) return;
		if (!window.confirm(
			`Reset ${selected.displayName} credentials?\n\nThis deletes Admin/database credentials so environment variable fallback can apply. This cannot be undone from the UI.`,
		)) {
			return;
		}
		setBusy('reset');
		try {
			const response = await apiServerClient.fetch(`/admin/v1/authentication-providers/${selected.id}/reset`, {
				method: 'POST',
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			applyProvider(payload);
			toast({
				title: 'Credentials reset',
				description: payload.source === 'environment'
					? 'Database credentials cleared. Environment fallback is active.'
					: 'Database credentials cleared. Provider is not configured until you save or set env vars.',
			});
		} catch (error) {
			toast({ variant: 'destructive', title: 'Reset failed', description: error.message });
		} finally {
			setBusy('');
		}
	};

	const redirectMismatch = Boolean(
		selected?.canonicalRedirectUri
		&& form.redirectUri
		&& String(form.redirectUri).replace(/\/+$/, '') !== String(selected.canonicalRedirectUri).replace(/\/+$/, ''),
	) || Boolean(selected?.redirectUriMismatchRisk);

	return (
		<div>
			<AdminHero
				title="Authentication Providers"
				description="Platform login IdPs (Google first). Separate from Pinterest/Facebook publishing OAuth. Secrets are encrypted and never returned to the browser."
			/>

			<section className="admin-card mb-4">
				<p className="admin-note mt-0 mb-3">
					Configure Google OAuth Client ID and Secret for Login / Signup. Apple, Microsoft, GitHub, and Discord are reserved for later phases.
					Authorized redirect URI in Google Cloud Console must match the Redirect URI below exactly.
				</p>

				{loading ? (
					<p className="admin-note flex items-center gap-2">
						<Loader2 size={14} className="animate-spin" /> Loading authentication providers…
					</p>
				) : (
					<div className="grid gap-4 lg:grid-cols-[240px_1fr]">
						<div className="space-y-2">
							{items.map((provider) => (
								<button
									key={provider.id}
									type="button"
									className={`admin-btn w-full justify-between ${selectedId === provider.id ? 'admin-btn--primary' : ''}`}
									onClick={() => setSelectedId(provider.id)}
								>
									<span className="inline-flex items-center gap-2">
										<KeyRound size={13} />
										{provider.displayName}
									</span>
									<StatusPill status={pillToneForStatus(provider.status)} />
								</button>
							))}
						</div>

						{selected ? (
							<form className="space-y-3" onSubmit={save}>
								<div className="flex items-start justify-between gap-3">
									<div>
										<h3 className="m-0">{selected.displayName}</h3>
										<p className="admin-note mt-1 mb-0">{selected.docsHint || 'Login authentication provider.'}</p>
									</div>
									<div className="text-right">
										<StatusPill status={pillToneForStatus(selected.status)} />
										<p className="admin-note mt-1 mb-0">{selected.statusLabel}</p>
									</div>
								</div>

								{!selected.configurable ? (
									<p className="admin-note mt-0">
										{selected.displayName} is reserved in the catalog. Configuration will unlock in a later phase — publishing OAuth stays on Pinterest / Facebook Accounts pages.
									</p>
								) : (
									<>
										<div className="admin-config-grid">
											<label>
												<span>Client ID</span>
												<input
													value={form.clientId}
													onChange={(e) => updateForm({ clientId: e.target.value })}
													placeholder={selected.placeholders?.clientId || 'Client ID'}
													autoComplete="off"
												/>
											</label>
											<label>
												<span>Client Secret</span>
												<input
													type="password"
													value={form.clientSecret}
													onChange={(e) => updateForm({ clientSecret: e.target.value })}
													placeholder={selected.hasClientSecret ? selected.clientSecretMasked || '••••••••' : 'Paste Client Secret'}
													autoComplete="new-password"
												/>
											</label>
											<label className="md:col-span-2">
												<span>Redirect URI</span>
												<div className="flex flex-wrap gap-2">
													<input
														className="flex-1"
														value={form.redirectUri}
														onChange={(e) => updateForm({ redirectUri: e.target.value })}
														placeholder={selected.canonicalRedirectUri || selected.placeholders?.redirectUri || ''}
														autoComplete="off"
													/>
													<button type="button" className="admin-btn" onClick={copyRedirectUri}>
														<Copy size={12} /> Copy Redirect URI
													</button>
												</div>
											</label>
											<label className="md:col-span-2">
												<span>Scopes</span>
												<input
													value={form.scopes}
													onChange={(e) => updateForm({ scopes: e.target.value })}
													placeholder={selected.placeholders?.scopes || ''}
													autoComplete="off"
												/>
											</label>
										</div>

										{redirectMismatch ? (
											<p className="admin-note mt-0 flex items-start gap-2" role="alert">
												<ShieldAlert size={14} className="mt-0.5 shrink-0" />
												<span>
													Redirect URI differs from the platform canonical URI
													{' '}(<code>{selected.canonicalRedirectUri}</code>).
													Google Cloud Console Authorized redirect URIs must match exactly or login will fail.
												</span>
											</p>
										) : (
											<p className="admin-note mt-0">
												Use this exact URI in Google Cloud Console → Authorized redirect URIs:
												{' '}<code>{form.redirectUri || selected.canonicalRedirectUri}</code>
											</p>
										)}

										<div className="flex flex-wrap items-center gap-3">
											<label className="inline-flex items-center gap-2">
												<input
													type="checkbox"
													checked={Boolean(form.enabled)}
													onChange={(e) => updateForm({ enabled: e.target.checked })}
												/>
												<span>Login provider enabled</span>
											</label>
											<button type="submit" className="admin-btn admin-btn--primary" disabled={Boolean(busy)}>
												{busy === 'save' ? 'Saving…' : 'Save provider'}
											</button>
											<button type="button" className="admin-btn" disabled={Boolean(busy)} onClick={testConnection}>
												{busy === 'test' ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />}
												{busy === 'test' ? ' Testing…' : ' Test Connection'}
											</button>
											<button type="button" className="admin-btn" disabled={Boolean(busy)} onClick={rotateSecret}>
												{busy === 'rotate' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
												{' '}Rotate Secret
											</button>
											<button type="button" className="admin-btn admin-btn--danger" disabled={Boolean(busy)} onClick={resetCredentials}>
												{busy === 'reset' ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
												{' '}Reset Credentials
											</button>
										</div>

										<div className="admin-provider__meta">
											<div>Status · <strong>{selected.statusLabel}</strong></div>
											<div>Source · <strong>{selected.sourceLabel}</strong></div>
											<div>Provider Version · <strong>{selected.providerVersion || '—'}</strong></div>
											<div>Last Updated · <strong>{selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '—'}</strong></div>
											<div>Updated By · <strong>{selected.updatedBy || '—'}</strong></div>
											<div>
												Last Test ·{' '}
												<strong>
													{selected.lastTestAt
														? `${selected.lastTestOk ? 'OK' : 'Failed'} · ${new Date(selected.lastTestAt).toLocaleString()}`
														: '—'}
												</strong>
											</div>
											{selected.lastTestMessage ? (
												<div className="md:col-span-2">Test detail · <strong>{selected.lastTestMessage}</strong></div>
											) : null}
											<div>
												Secret · <strong>{selected.hasClientSecret ? (selected.clientSecretMasked || 'stored (masked)') : 'not set'}</strong>
											</div>
										</div>
									</>
								)}
							</form>
						) : null}
					</div>
				)}
			</section>
		</div>
	);
}
