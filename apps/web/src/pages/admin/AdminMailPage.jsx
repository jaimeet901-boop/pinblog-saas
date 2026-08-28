import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, RefreshCw, Send, Save, Link2 } from 'lucide-react';
import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

function emptySmtpForm(pb = {}) {
	return {
		enabled: Boolean(pb.smtpEnabled),
		host: pb.smtpHost || '',
		port: pb.smtpPort ?? 587,
		username: pb.smtpUsername || '',
		password: '',
		tls: pb.smtpTls !== false,
		senderName: pb.senderName || '',
		senderAddress: pb.senderEmail || '',
		appURL: pb.appUrl || '',
	};
}

export default function AdminMailPage() {
	const { toast } = useToast();
	const { user } = useAuth();
	const [data, setData] = useState(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState('');
	const [testEmail, setTestEmail] = useState(user?.email || '');
	const [form, setForm] = useState(() => emptySmtpForm());

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/mail');
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setData(payload);
			setForm(emptySmtpForm(payload.pocketbase || {}));
			if (!testEmail && payload.pocketbase?.senderEmail) {
				setTestEmail(user?.email || '');
			}
		} catch (error) {
			toast({ variant: 'destructive', title: 'Mail diagnostics failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [toast, testEmail, user?.email]);

	useEffect(() => {
		load();
		// eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
	}, []);

	const runTest = async () => {
		setBusy('test');
		try {
			const response = await apiServerClient.fetch('/admin/v1/mail/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ toEmail: testEmail, template: 'password-reset' }),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(payload.message || await readApiError(response));
			toast({
				title: 'Test email requested',
				description: payload.warning || payload.message || 'Check inbox and mail logs.',
			});
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Test email failed', description: error.message });
			await load();
		} finally {
			setBusy('');
		}
	};

	const syncPlatform = async () => {
		setBusy('sync');
		try {
			const response = await apiServerClient.fetch('/admin/v1/mail/sync-platform-smtp', { method: 'POST' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(payload.message || await readApiError(response));
			toast({ title: 'SMTP synced', description: payload.message });
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'SMTP sync failed', description: error.message });
			await load();
		} finally {
			setBusy('');
		}
	};

	const saveSettings = async (event) => {
		event.preventDefault();
		setBusy('save');
		try {
			const response = await apiServerClient.fetch('/admin/v1/mail/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					smtp: {
						enabled: form.enabled,
						host: form.host,
						port: Number(form.port) || 587,
						username: form.username,
						password: form.password || undefined,
						tls: form.tls,
					},
					meta: {
						senderName: form.senderName,
						senderAddress: form.senderAddress,
						appURL: form.appURL,
					},
				}),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(payload.message || await readApiError(response));
			toast({ title: 'PocketBase Mail updated', description: payload.message });
			setForm((prev) => ({ ...prev, password: '' }));
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Save failed', description: error.message });
		} finally {
			setBusy('');
		}
	};

	const pb = data?.pocketbase || {};
	const builder = data?.builderMailer || {};
	const logs = data?.logs?.items || [];
	const lastError = data?.lastMailError;

	return (
		<div className="space-y-6">
			<AdminHero
				title="Mail Diagnostics"
				description="PocketBase Mail powers password reset and verification. Platform Email Settings alone do not send those emails."
				action={(
					<button type="button" className="admin-btn" onClick={load} disabled={loading || Boolean(busy)}>
						{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={14} />}
						Refresh
					</button>
				)}
			/>

			{loading && !data ? (
				<div className="flex min-h-[30vh] items-center justify-center text-[#e8a87c]"><Loader2 className="h-6 w-6 animate-spin" /></div>
			) : (
				<>
					<div className="admin-config-grid">
						<div className="admin-card">
							<p className="admin-stat__label">Mail status</p>
							<div className="mt-2"><StatusPill status={data?.status || 'unknown'} /></div>
							<p className="admin-note mt-2">Delivery path: <strong>{data?.deliveryPath || 'none'}</strong></p>
						</div>
						<div className="admin-card">
							<p className="admin-stat__label">SMTP enabled</p>
							<p className="mt-2 text-lg font-semibold">{pb.smtpEnabled ? 'Yes' : 'No'}</p>
							<p className="admin-note mt-1">{pb.smtpHost || 'No host configured'}</p>
						</div>
						<div className="admin-card">
							<p className="admin-stat__label">Sender email</p>
							<p className="mt-2 text-sm font-medium break-all">{pb.senderEmail || '—'}</p>
							<p className="admin-note mt-1">{pb.senderName || 'No sender name'}</p>
						</div>
						<div className="admin-card">
							<p className="admin-stat__label">Application URL</p>
							<p className="mt-2 text-sm font-medium break-all">{data?.applicationUrl || pb.appUrl || '—'}</p>
							<p className="admin-note mt-1">Used in reset links</p>
						</div>
					</div>

					<div className="admin-card">
						<div className="flex flex-wrap items-center justify-between gap-2 mb-3">
							<div>
								<h2 className="text-base font-semibold">Builder Mail fallback</h2>
								<p className="admin-note">Used only when PocketBase SMTP is disabled.</p>
							</div>
							<StatusPill status={builder.configured ? 'configured' : 'not_configured'} />
						</div>
						<div className="admin-config-grid">
							<div>
								<p className="admin-stat__label">API URL</p>
								<p className="text-sm break-all">{builder.apiUrl || '—'}</p>
							</div>
							<div>
								<p className="admin-stat__label">Sender</p>
								<p className="text-sm break-all">{builder.senderAddress || '—'}</p>
							</div>
							<div>
								<p className="admin-stat__label">API key</p>
								<p className="text-sm">{builder.apiKeySet ? 'Set' : 'Missing'}</p>
							</div>
						</div>
					</div>

					{lastError ? (
						<div className="admin-card border border-red-500/30">
							<p className="admin-stat__label flex items-center gap-2"><Mail size={14} /> Last mail error</p>
							<p className="mt-2 text-sm text-red-200">{lastError.message || JSON.stringify(lastError)}</p>
							<p className="admin-note mt-1">
								{lastError.at || lastError.source || ''}
								{lastError.toEmail ? ` · ${lastError.toEmail}` : ''}
							</p>
						</div>
					) : (
						<div className="admin-card">
							<p className="admin-stat__label">Last mail error</p>
							<p className="mt-2 text-sm text-muted-foreground">None recorded since last successful send/test.</p>
						</div>
					)}

					<div className="admin-card">
						<h2 className="text-base font-semibold mb-1">Send test email</h2>
						<p className="admin-note mb-3">
							Uses PocketBase <code>settings.testEmail</code> (password-reset template). A 204 from forgot-password does not prove delivery.
						</p>
						<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
							<label className="flex-1 text-sm">
								<span className="admin-stat__label">To email</span>
								<input
									className="admin-input mt-1 w-full"
									type="email"
									value={testEmail}
									onChange={(e) => setTestEmail(e.target.value)}
									placeholder="you@example.com"
								/>
							</label>
							<button type="button" className="admin-btn admin-btn--primary" onClick={runTest} disabled={Boolean(busy) || !testEmail}>
								{busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send size={14} />}
								Send Test Email
							</button>
						</div>
					</div>

					<form className="admin-card space-y-3" onSubmit={saveSettings}>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div>
								<h2 className="text-base font-semibold">PocketBase Mail settings</h2>
								<p className="admin-note">Edits live PocketBase SMTP / meta (password reset source of truth).</p>
							</div>
							<button type="button" className="admin-btn" onClick={syncPlatform} disabled={Boolean(busy)}>
								{busy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 size={14} />}
								Sync platform SMTP → PocketBase
							</button>
						</div>
						<div className="admin-config-grid">
							<label className="text-sm flex items-center gap-2 pt-6">
								<input type="checkbox" checked={form.enabled} onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))} />
								SMTP enabled
							</label>
							<label className="text-sm">
								<span className="admin-stat__label">SMTP host</span>
								<input className="admin-input mt-1 w-full" value={form.host} onChange={(e) => setForm((p) => ({ ...p, host: e.target.value }))} />
							</label>
							<label className="text-sm">
								<span className="admin-stat__label">SMTP port</span>
								<input className="admin-input mt-1 w-full" value={form.port} onChange={(e) => setForm((p) => ({ ...p, port: e.target.value }))} />
							</label>
							<label className="text-sm">
								<span className="admin-stat__label">SMTP username</span>
								<input className="admin-input mt-1 w-full" value={form.username} onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))} />
							</label>
							<label className="text-sm">
								<span className="admin-stat__label">SMTP password</span>
								<input className="admin-input mt-1 w-full" type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} placeholder={pb.smtpPasswordSet ? '•••• leave blank to keep' : ''} />
							</label>
							<label className="text-sm flex items-center gap-2 pt-6">
								<input type="checkbox" checked={form.tls} onChange={(e) => setForm((p) => ({ ...p, tls: e.target.checked }))} />
								TLS
							</label>
							<label className="text-sm">
								<span className="admin-stat__label">Sender name</span>
								<input className="admin-input mt-1 w-full" value={form.senderName} onChange={(e) => setForm((p) => ({ ...p, senderName: e.target.value }))} />
							</label>
							<label className="text-sm">
								<span className="admin-stat__label">Sender email</span>
								<input className="admin-input mt-1 w-full" value={form.senderAddress} onChange={(e) => setForm((p) => ({ ...p, senderAddress: e.target.value }))} />
							</label>
							<label className="text-sm sm:col-span-2">
								<span className="admin-stat__label">Application URL</span>
								<input className="admin-input mt-1 w-full" value={form.appURL} onChange={(e) => setForm((p) => ({ ...p, appURL: e.target.value }))} placeholder="https://seodeva.com" />
							</label>
						</div>
						<button type="submit" className="admin-btn admin-btn--primary" disabled={Boolean(busy)}>
							{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save size={14} />}
							Save PocketBase Mail
						</button>
					</form>

					<div className="admin-card">
						<h2 className="text-base font-semibold mb-2">Mail logs</h2>
						<p className="admin-note mb-3">Recent PocketBase logs matching mailer / smtp / Failed to send email.</p>
						{data?.logs?.error ? (
							<p className="text-sm text-red-300">{data.logs.error}</p>
						) : null}
						{logs.length === 0 ? (
							<p className="text-sm text-muted-foreground">No matching logs yet. Trigger a password reset or test email after configuring SMTP.</p>
						) : (
							<div className="space-y-2 max-h-[28rem] overflow-auto">
								{logs.map((item) => (
									<div key={item.id} className="rounded-lg border border-white/10 px-3 py-2 text-sm">
										<div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
											<span>{item.created}</span>
											<span>{item.level}</span>
										</div>
										<p className="mt-1 whitespace-pre-wrap break-words">{item.message}</p>
									</div>
								))}
							</div>
						)}
					</div>
				</>
			)}
		</div>
	);
}
