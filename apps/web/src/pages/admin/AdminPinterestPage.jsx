import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminHero, StatusPill, AdminEmptyState } from '@/components/admin/AdminUi';
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

const EMPTY_OAUTH = {
	appId: 'YOUR_PINTEREST_APP_ID',
	appSecretMasked: '',
	hasAppSecret: false,
	redirectUri: '',
	scopes: 'boards:read,pins:read,pins:write,user_accounts:read',
	enabled: false,
	trialAccessPending: true,
	configured: false,
	source: 'placeholder',
};

export default function AdminPinterestPage() {
	const { toast } = useToast();
	const [search, setSearch] = useState('');
	const [status, setStatus] = useState('');
	const [accounts, setAccounts] = useState([]);
	const [loading, setLoading] = useState(true);
	const [oauthLoading, setOauthLoading] = useState(true);
	const [oauthSaving, setOauthSaving] = useState(false);
	const [oauth, setOauth] = useState(EMPTY_OAUTH);
	const [appId, setAppId] = useState(EMPTY_OAUTH.appId);
	const [appSecret, setAppSecret] = useState('');
	const [redirectUri, setRedirectUri] = useState('');
	const [scopes, setScopes] = useState(EMPTY_OAUTH.scopes);
	const [enabled, setEnabled] = useState(false);
	const [trialAccessPending, setTrialAccessPending] = useState(true);

	const loadAccounts = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (search.trim()) params.set('q', search.trim());
			if (status) params.set('status', status);
			const response = await apiServerClient.fetch(`/admin/v1/inventory/pinterest-accounts?${params.toString()}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setAccounts(Array.isArray(payload.items) ? payload.items : []);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Pinterest accounts failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [search, status, toast]);

	const loadOauth = useCallback(async () => {
		setOauthLoading(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/pinterest/oauth-config');
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setOauth(payload);
			setAppId(payload.appId || EMPTY_OAUTH.appId);
			setAppSecret('');
			setRedirectUri(payload.redirectUri || '');
			setScopes(payload.scopes || EMPTY_OAUTH.scopes);
			setEnabled(Boolean(payload.enabled));
			setTrialAccessPending(Boolean(payload.trialAccessPending));
		} catch (error) {
			toast({ variant: 'destructive', title: 'OAuth config failed', description: error.message });
		} finally {
			setOauthLoading(false);
		}
	}, [toast]);

	useEffect(() => {
		loadAccounts();
	}, [loadAccounts]);

	useEffect(() => {
		loadOauth();
	}, [loadOauth]);

	const saveOauth = async (event) => {
		event.preventDefault();
		setOauthSaving(true);
		try {
			const body = {
				appId: appId.trim(),
				redirectUri: redirectUri.trim(),
				scopes: scopes.trim(),
				enabled,
				trialAccessPending,
			};
			if (appSecret.trim() && !appSecret.includes('•')) {
				body.appSecret = appSecret.trim();
			}
			const response = await apiServerClient.fetch('/admin/v1/pinterest/oauth-config', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setOauth(payload);
			setAppSecret('');
			toast({ title: 'Pinterest OAuth saved', description: 'App credentials are stored encrypted in PocketBase.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Save failed', description: error.message });
		} finally {
			setOauthSaving(false);
		}
	};

	const oauthStatus = oauth.configured
		? 'healthy'
		: (oauth.trialAccessPending ? 'pending' : 'degraded');

	return (
		<div>
			<AdminHero
				title="Pinterest Accounts"
				description="Platform Pinterest OAuth app credentials and connected account inventory from PocketBase."
			/>

			<section className="admin-card mb-4">
				<div className="flex items-start justify-between gap-3 mb-3">
					<div>
						<h3 className="m-0">Pinterest OAuth App</h3>
						<p className="admin-note mt-1 mb-0">
							Configure App ID, App Secret, Redirect URI, and scopes once. Secrets are encrypted and never exposed to workspace users.
						</p>
					</div>
					<StatusPill status={oauthStatus} />
				</div>

				{oauthLoading ? (
					<p className="admin-note flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading OAuth config…</p>
				) : (
					<form className="space-y-3" onSubmit={saveOauth}>
						{oauth.trialAccessPending && (
							<p className="admin-note mt-0">
								Trial Access pending — configure App ID and App Secret once Pinterest approves Trial Access. Workspace Connect waits until credentials are live.
							</p>
						)}
						<div className="admin-config-grid">
							<label>
								<span>App ID</span>
								<input
									value={appId}
									onChange={(e) => setAppId(e.target.value)}
									placeholder="YOUR_PINTEREST_APP_ID"
									autoComplete="off"
								/>
							</label>
							<label>
								<span>App Secret</span>
								<input
									type="password"
									value={appSecret}
									onChange={(e) => setAppSecret(e.target.value)}
									placeholder={oauth.hasAppSecret ? oauth.appSecretMasked || '••••••••' : 'Paste App Secret'}
									autoComplete="new-password"
								/>
							</label>
							<label className="md:col-span-2">
								<span>Redirect URI</span>
								<input
									value={redirectUri}
									onChange={(e) => setRedirectUri(e.target.value)}
									placeholder="https://api.example.com/pinterest/oauth/callback"
									autoComplete="off"
								/>
							</label>
							<label className="md:col-span-2">
								<span>OAuth scopes</span>
								<input
									value={scopes}
									onChange={(e) => setScopes(e.target.value)}
									placeholder="boards:read,pins:read,pins:write,user_accounts:read"
									autoComplete="off"
								/>
							</label>
						</div>
						<div className="flex flex-wrap items-center gap-4">
							<label className="inline-flex items-center gap-2">
								<input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
								<span>OAuth enabled</span>
							</label>
							<label className="inline-flex items-center gap-2">
								<input
									type="checkbox"
									checked={trialAccessPending}
									onChange={(e) => setTrialAccessPending(e.target.checked)}
								/>
								<span>Trial Access pending</span>
							</label>
							<button type="submit" className="admin-btn" disabled={oauthSaving}>
								{oauthSaving ? 'Saving…' : 'Save OAuth settings'}
							</button>
						</div>
						<p className="admin-note mb-0">
							Source · {oauth.source}
							{oauth.hasAppSecret ? ' · secret stored' : ' · secret not set'}
							{oauth.updatedAt ? ` · updated ${new Date(oauth.updatedAt).toLocaleString()}` : ''}
						</p>
					</form>
				)}
			</section>

			<div className="admin-toolbar mb-3">
				<label className="min-w-[12rem] flex-1">
					<span>Search</span>
					<input
						placeholder="Account or workspace"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</label>
				<label>
					<span>Status</span>
					<select value={status} onChange={(e) => setStatus(e.target.value)}>
						<option value="">All</option>
						<option value="connected">Connected</option>
						<option value="degraded">Degraded</option>
					</select>
				</label>
			</div>
			{loading ? (
				<section className="admin-card">
					<p className="admin-note flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading accounts…</p>
				</section>
			) : accounts.length === 0 ? (
				<section className="admin-card">
					<AdminEmptyState title="No accounts match" description="Adjust search or status filters and try again." />
				</section>
			) : (
				<div className="admin-workspace-grid">
					{accounts.map((account) => (
						<article key={account.id} className="admin-workspace">
							<div className="flex items-start justify-between gap-2">
								<h4>{account.name}</h4>
								<StatusPill status={account.status} />
							</div>
							<p>Workspace · {account.workspace}</p>
							<p>Username · @{String(account.username || '').replace(/^@/, '') || '—'}</p>
							<p>Connected · {account.connectedAt || '—'}</p>
							<p>Expires · {account.expiresAt || '—'}</p>
							<p>Last sync · {account.lastSyncAt || '—'}</p>
							<p>Boards · {account.boards}</p>
						</article>
					))}
				</div>
			)}
		</div>
	);
}
