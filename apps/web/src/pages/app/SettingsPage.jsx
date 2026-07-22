import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Link2, Loader2, Save, Unlink, User, Building2, Globe, Pin,
	Bell, Shield, Palette, SlidersHorizontal, Settings2, RotateCcw,
	ExternalLink, RefreshCw, Download, Upload, AlertTriangle, BookOpen,
	LifeBuoy, Mail, Crown, Coins, HardDrive,
} from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Input, Select, Spinner, Textarea } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { OAUTH_PROVIDERS, getEnabledProviderNames, normalizePocketBaseError } from '@/lib/auth';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import './SettingsPage.css';

const TABS = [
	{ id: 'general', label: 'General', icon: Settings2 },
	{ id: 'profile', label: 'Profile', icon: User },
	{ id: 'workspace', label: 'Workspace', icon: Building2 },
	{ id: 'websites', label: 'Websites', icon: Globe },
	{ id: 'wordpress', label: 'WordPress', icon: Globe },
	{ id: 'pinterest', label: 'Pinterest', icon: Pin },
	{ id: 'notifications', label: 'Notifications', icon: Bell },
	{ id: 'security', label: 'Security', icon: Shield },
	{ id: 'appearance', label: 'Appearance', icon: Palette },
	{ id: 'advanced', label: 'Advanced', icon: SlidersHorizontal },
];

const PREFS_KEY = 'chefia-workspace-prefs';
const PLAN_QUOTA = { free: 5, starter: 50, pro: 200, agency: 1000 };

const defaultPrefs = {
	workspaceName: '',
	workspaceLogo: '',
	workspaceDescription: '',
	defaultWebsiteId: '',
	defaultLanguage: 'English',
	timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
	language: 'English',
	emailNotifications: true,
	publishingNotifications: true,
	failureAlerts: true,
	weeklyReports: false,
	marketingEmails: false,
	accentColor: 'coral',
	dateFormat: 'locale',
	timeFormat: '24h',
};

function loadPrefs() {
	try {
		const raw = localStorage.getItem(PREFS_KEY);
		const parsed = raw ? JSON.parse(raw) : {};
		return { ...defaultPrefs, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
	} catch {
		return { ...defaultPrefs };
	}
}

function SwitchRow({ label, checked, onChange, hint }) {
	return (
		<label className="set-switch">
			<span>
				<span className="block">{label}</span>
				{hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
			</span>
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
		</label>
	);
}

export default function SettingsPage() {
	const { toast } = useToast();
	const { user, refresh, authMethods, externalAuths, connectProvider, disconnectProvider, logout } = useAuth();
	const { theme, toggle } = useTheme();

	const [tab, setTab] = useState('general');
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [providerAction, setProviderAction] = useState('');
	const [websites, setWebsites] = useState([]);
	const [pinterestAccounts, setPinterestAccounts] = useState([]);
	const [name, setName] = useState(user?.name || '');
	const [prefs, setPrefs] = useState(() => loadPrefs());
	const [baseline, setBaseline] = useState(() => ({ name: user?.name || '', prefs: loadPrefs() }));
	const [passwordForm, setPasswordForm] = useState({ oldPassword: '', password: '', passwordConfirm: '' });

	const enabledProviders = useMemo(() => getEnabledProviderNames(authMethods), [authMethods]);
	const connectedProviders = useMemo(() => new Set((externalAuths || []).map((item) => item.provider)), [externalAuths]);

	const primaryWebsite = useMemo(() => {
		if (prefs.defaultWebsiteId) {
			return websites.find((site) => site.id === prefs.defaultWebsiteId) || null;
		}
		return websites.find((site) => site.status === 'connected') || websites[0] || null;
	}, [websites, prefs.defaultWebsiteId]);

	const isDirty = useMemo(() => (
		name !== baseline.name || JSON.stringify(prefs) !== JSON.stringify(baseline.prefs)
	), [name, prefs, baseline]);

	const creditsRemaining = useMemo(() => {
		const quota = PLAN_QUOTA[user?.plan || 'free'] || 5;
		return quota;
	}, [user?.plan]);

	const loadWorkspaceData = async () => {
		setLoading(true);
		try {
			const [websiteRows, accountsRes] = await Promise.all([
				pb.collection('websites').getFullList({ sort: '-created', requestKey: 'settings-websites' }).catch(() => []),
				apiServerClient.fetch('/pinterest/accounts?filter=active', { method: 'GET' })
					.then(async (response) => {
						const payload = await response.json().catch(() => ({}));
						return response.ok && Array.isArray(payload.items) ? payload.items : [];
					})
					.catch(() => []),
			]);
			setWebsites(websiteRows);
			setPinterestAccounts(accountsRes);
			setName(user?.name || '');
			const nextPrefs = {
				...loadPrefs(),
				workspaceName: loadPrefs().workspaceName || user?.name || 'Chef IA Workspace',
			};
			setPrefs(nextPrefs);
			setBaseline({ name: user?.name || '', prefs: nextPrefs });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error?.message || 'Failed to load workspace settings' });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		loadWorkspaceData();
	}, []);

	useEffect(() => {
		if (user?.name != null) {
			setName(user.name || '');
		}
	}, [user?.name]);

	const updatePref = (key, value) => {
		setPrefs((prev) => ({ ...prev, [key]: value }));
	};

	const saveChanges = async (event) => {
		event?.preventDefault?.();
		setSaving(true);
		try {
			if (name.trim() && name.trim() !== (user?.name || '')) {
				await pb.collection('users').update(user.id, { name: name.trim() });
				await refresh();
			}
			localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
			setBaseline({ name: name.trim() || user?.name || '', prefs: { ...prefs } });
			toast({ title: 'Settings saved', description: 'Workspace preferences were updated.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error?.message || 'Could not save settings.' });
		} finally {
			setSaving(false);
		}
	};

	const resetChanges = () => {
		setName(baseline.name);
		setPrefs({ ...baseline.prefs });
		toast({ title: 'Changes reset', description: 'Reverted to the last saved workspace settings.' });
	};

	const handleConnectProvider = async (provider) => {
		const popup = window.open('', 'pb-oauth', 'popup=yes,width=560,height=720');
		if (!popup) {
			toast({ variant: 'destructive', title: 'Popup blocked', description: 'Please allow popups to connect this account.' });
			return;
		}

		setProviderAction(provider);
		try {
			await connectProvider(provider, popup);
			toast({ title: `${OAUTH_PROVIDERS[provider].label} connected`, description: 'The provider is now linked to your workspace.' });
		} catch (error) {
			toast({ variant: 'destructive', title: `${OAUTH_PROVIDERS[provider].label} connection failed`, description: normalizePocketBaseError(error, 'Could not connect this provider.') });
		} finally {
			if (!popup.closed) {
				popup.close();
			}
			setProviderAction('');
		}
	};

	const handleDisconnectProvider = async (provider) => {
		setProviderAction(provider);
		try {
			await disconnectProvider(provider);
			toast({ title: `${OAUTH_PROVIDERS[provider].label} disconnected`, description: 'The provider was removed from your connected accounts.' });
		} catch (error) {
			toast({ variant: 'destructive', title: `${OAUTH_PROVIDERS[provider].label} disconnect failed`, description: normalizePocketBaseError(error, 'Could not disconnect this provider.') });
		} finally {
			setProviderAction('');
		}
	};

	const changePassword = async (event) => {
		event.preventDefault();
		if (!passwordForm.oldPassword || !passwordForm.password) {
			toast({ variant: 'destructive', title: 'Missing fields', description: 'Enter your current and new password.' });
			return;
		}
		if (passwordForm.password !== passwordForm.passwordConfirm) {
			toast({ variant: 'destructive', title: 'Passwords do not match', description: 'Confirm the new password carefully.' });
			return;
		}
		setSaving(true);
		try {
			await pb.collection('users').update(user.id, {
				oldPassword: passwordForm.oldPassword,
				password: passwordForm.password,
				passwordConfirm: passwordForm.passwordConfirm,
			});
			setPasswordForm({ oldPassword: '', password: '', passwordConfirm: '' });
			toast({ title: 'Password updated' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: normalizePocketBaseError(error, 'Could not change password.') });
		} finally {
			setSaving(false);
		}
	};

	const exportSettings = () => {
		const payload = {
			exportedAt: new Date().toISOString(),
			profile: { name, email: user?.email },
			prefs,
		};
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'chefia-workspace-settings.json';
		anchor.click();
		URL.revokeObjectURL(url);
		toast({ title: 'Exported', description: 'Workspace preferences downloaded.' });
	};

	const importSettings = async (file) => {
		if (!file) return;
		try {
			const text = await file.text();
			const parsed = JSON.parse(text);
			if (parsed?.prefs && typeof parsed.prefs === 'object') {
				setPrefs((prev) => ({ ...prev, ...parsed.prefs }));
				toast({ title: 'Settings imported', description: 'Review and save to apply.' });
			} else {
				throw new Error('Invalid settings file');
			}
		} catch (error) {
			toast({ variant: 'destructive', title: 'Import failed', description: error?.message || 'Could not read settings file.' });
		}
	};

	const resetPreferences = () => {
		const next = {
			...defaultPrefs,
			workspaceName: user?.name || 'Chef IA Workspace',
		};
		setPrefs(next);
		localStorage.setItem(PREFS_KEY, JSON.stringify(next));
		setBaseline({ name: user?.name || '', prefs: next });
		toast({ title: 'Preferences reset' });
	};

	const unavailable = (label) => {
		toast({
			title: `${label} unavailable`,
			description: 'This action is not available from workspace settings with the current platform APIs.',
		});
	};

	const ensureTheme = (desired) => {
		if (theme !== desired) toggle();
	};

	const initials = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();

	return (
		<div className="set-atelier">
			<section className="set-hero">
				<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<p className="set-hero__eyebrow">Chef IA Workspace Settings</p>
						<h1 className="set-hero__title">{prefs.workspaceName || user?.name || 'Workspace'}</h1>
						<div className="set-hero__meta">
							<span className="set-avatar">{initials}</span>
							<span className="set-pill"><Crown size={12} /> {(user?.plan || 'free').toString()} plan</span>
							<span className="set-pill"><Globe size={12} /> {primaryWebsite?.name || primaryWebsite?.domain || 'No website yet'}</span>
							<span className="set-pill"><Mail size={12} /> {user?.email || '—'}</span>
							{isDirty ? (
								<span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
									Unsaved changes
								</span>
							) : (
								<span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground">Saved</span>
							)}
						</div>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button onClick={saveChanges} disabled={saving || !isDirty}>
							{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save size={15} />}
							Save Changes
						</Button>
						<Button variant="outline" onClick={resetChanges} disabled={!isDirty}>
							<RotateCcw size={15} /> Reset Changes
						</Button>
					</div>
				</div>
			</section>

			{loading ? (
				<div className="set-shell">
					<div className="set-tabs space-y-2 p-4">{[0, 1, 2, 3].map((i) => <div key={i} className="set-skeleton" style={{ height: '2.5rem' }} />)}</div>
					<div className="set-main space-y-3">{[0, 1, 2].map((i) => <div key={i} className="set-skeleton" />)}</div>
					<div className="set-side space-y-3 p-4">{[0, 1].map((i) => <div key={i} className="set-skeleton" />)}</div>
				</div>
			) : (
				<div className="set-shell">
					<aside className="set-tabs">
						<p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Settings</p>
						{TABS.map((item) => {
							const Icon = item.icon;
							return (
								<button
									key={item.id}
									type="button"
									className={`set-tab ${tab === item.id ? 'is-active' : ''}`}
									onClick={() => setTab(item.id)}
								>
									<Icon size={15} />
									{item.label}
								</button>
							);
						})}
					</aside>

					<section className="set-main">
						<div className="set-tabs-mobile">
							{TABS.map((item) => (
								<button
									key={item.id}
									type="button"
									className={tab === item.id ? 'is-active' : ''}
									onClick={() => setTab(item.id)}
								>
									{item.label}
								</button>
							))}
						</div>

						{tab === 'general' ? (
							<div className="set-section">
								<div className="set-card">
									<h3>Workspace overview</h3>
									<p className="hint">Manage profile, websites, and connected login providers for this workspace.</p>
									<div className="mt-4 grid gap-2 sm:grid-cols-2">
										<Button size="sm" variant="outline" onClick={() => setTab('profile')}><User size={14} /> Edit profile</Button>
										<Button size="sm" variant="outline" onClick={() => setTab('websites')}><Globe size={14} /> Manage websites</Button>
										<Button size="sm" variant="outline" onClick={() => setTab('pinterest')}><Pin size={14} /> Pinterest accounts</Button>
										<Button size="sm" variant="outline" onClick={() => setTab('security')}><Shield size={14} /> Security</Button>
									</div>
								</div>
								<div className="set-managed">
									<strong>This workspace uses centrally managed AI services.</strong>
									Platform API keys (OpenAI, Gemini, Fal.ai, SMTP, and provider secrets) are managed exclusively by the Super User Admin Panel.
									<span className="mt-2 block text-muted-foreground">This setting is managed by the platform administrator.</span>
								</div>
								<div className="set-card">
									<h3>Connected login providers</h3>
									<p className="hint">Link Google or Pinterest to sign in faster and keep external auth in sync.</p>
									<div className="mt-4 grid gap-3 md:grid-cols-2">
										{Object.values(OAUTH_PROVIDERS).map((provider) => {
											const connected = connectedProviders.has(provider.name);
											const supported = enabledProviders.size === 0 || enabledProviders.has(provider.name);
											return (
												<div key={provider.name} className="rounded-2xl border border-border/80 bg-card p-4">
													<div className="flex items-start justify-between gap-3">
														<div>
															<p className="font-medium">{provider.label}</p>
															<p className="mt-1 text-sm text-muted-foreground">{provider.description}</p>
														</div>
														<Badge tone={connected ? 'green' : 'amber'}>{connected ? 'connected' : 'not connected'}</Badge>
													</div>
													<div className="mt-4 flex flex-wrap gap-2">
														{connected ? (
															<Button size="sm" variant="outline" disabled={providerAction === provider.name} onClick={() => handleDisconnectProvider(provider.name)}>
																{providerAction === provider.name ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink size={14} />} Disconnect
															</Button>
														) : (
															<Button size="sm" disabled={!supported || providerAction === provider.name} onClick={() => handleConnectProvider(provider.name)}>
																{providerAction === provider.name ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 size={14} />} Connect
															</Button>
														)}
													</div>
													{!supported ? <p className="mt-2 text-xs text-muted-foreground">Enable {provider.label} OAuth2 in PocketBase to use this action.</p> : null}
												</div>
											);
										})}
									</div>
								</div>
							</div>
						) : null}

						{tab === 'profile' ? (
							<div className="set-section">
								<div className="set-card">
									<div className="mb-4 flex items-center gap-3">
										<span className="set-avatar" style={{ width: '3.5rem', height: '3.5rem', fontSize: '1.25rem' }}>{initials}</span>
										<div>
											<p className="font-semibold">{name || user?.name || 'Chef'}</p>
											<p className="text-sm text-muted-foreground">{user?.email}</p>
										</div>
									</div>
									<form className="grid gap-3" onSubmit={saveChanges}>
										<Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
										<div>
											<span className="mb-1.5 block text-sm font-medium">Email</span>
											<div className="rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5 text-sm text-muted-foreground">{user?.email}</div>
										</div>
										<Select label="Timezone" value={prefs.timezone} onChange={(e) => updatePref('timezone', e.target.value)}>
											{[prefs.timezone, 'UTC', 'America/New_York', 'Europe/Paris', 'Europe/London', 'Asia/Dubai'].filter((v, i, arr) => arr.indexOf(v) === i).map((zone) => (
												<option key={zone} value={zone}>{zone}</option>
											))}
										</Select>
										<Select label="Language" value={prefs.language} onChange={(e) => updatePref('language', e.target.value)}>
											{['English', 'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Dutch', 'Arabic'].map((lang) => (
												<option key={lang}>{lang}</option>
											))}
										</Select>
										<Button type="submit" disabled={saving}><Save size={15} /> Save Profile</Button>
									</form>
								</div>
							</div>
						) : null}

						{tab === 'workspace' ? (
							<div className="set-section">
								<div className="set-card space-y-3">
									<h3>Workspace details</h3>
									<p className="hint">These preferences are stored for this browser workspace session.</p>
									<Input label="Workspace name" value={prefs.workspaceName} onChange={(e) => updatePref('workspaceName', e.target.value)} />
									<Input label="Workspace logo URL" value={prefs.workspaceLogo} onChange={(e) => updatePref('workspaceLogo', e.target.value)} placeholder="https://…" />
									<Textarea label="Workspace description" rows={3} value={prefs.workspaceDescription} onChange={(e) => updatePref('workspaceDescription', e.target.value)} />
									<Select label="Default website" value={prefs.defaultWebsiteId} onChange={(e) => updatePref('defaultWebsiteId', e.target.value)}>
										<option value="">None</option>
										{websites.map((site) => (
											<option key={site.id} value={site.id}>{site.name || site.domain || site.id}</option>
										))}
									</Select>
									<Select label="Default language" value={prefs.defaultLanguage} onChange={(e) => updatePref('defaultLanguage', e.target.value)}>
										{['English', 'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Dutch', 'Arabic'].map((lang) => (
											<option key={lang}>{lang}</option>
										))}
									</Select>
									<Select label="Timezone" value={prefs.timezone} onChange={(e) => updatePref('timezone', e.target.value)}>
										{[prefs.timezone, 'UTC', 'America/New_York', 'Europe/Paris', 'Europe/London', 'Asia/Dubai'].filter((v, i, arr) => arr.indexOf(v) === i).map((zone) => (
											<option key={zone} value={zone}>{zone}</option>
										))}
									</Select>
								</div>
							</div>
						) : null}

						{tab === 'websites' ? (
							<div className="set-section">
								<div className="set-card">
									<div className="mb-3 flex items-center justify-between gap-2">
										<div>
											<h3>Connected websites</h3>
											<p className="hint">Status and defaults for WordPress-connected sites.</p>
										</div>
										<Link to="/app/websites"><Button size="sm" variant="outline">Manage Website</Button></Link>
									</div>
									{websites.length === 0 ? (
										<div className="set-empty">
											<div className="set-empty__art" aria-hidden="true" />
											<p className="font-semibold">No websites connected</p>
											<p className="mt-1 text-sm text-muted-foreground">Add a WordPress site to publish articles from Chef IA.</p>
											<Link to="/app/websites" className="mt-4 inline-block"><Button size="sm">Open Websites</Button></Link>
										</div>
									) : (
										<div className="space-y-2">
											{websites.map((site) => (
												<div key={site.id} className="set-row">
													<div className="set-row__avatar"><Globe size={14} className="text-muted-foreground" /></div>
													<div className="min-w-0 flex-1">
														<p className="truncate text-sm font-semibold">{site.name || site.domain || 'Website'}</p>
														<p className="text-xs text-muted-foreground">
															Last sync: {site.updated || site.created ? new Date(site.updated || site.created).toLocaleString() : '—'}
														</p>
													</div>
													<Badge tone={site.status === 'connected' ? 'green' : 'amber'}>{site.status || 'unknown'}</Badge>
													{prefs.defaultWebsiteId === site.id ? <Badge tone="blue">Default</Badge> : (
														<Button size="sm" variant="ghost" onClick={() => updatePref('defaultWebsiteId', site.id)}>Set default</Button>
													)}
													{site.url ? (
														<a href={site.url} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><ExternalLink size={13} /> Open</Button></a>
													) : null}
												</div>
											))}
										</div>
									)}
								</div>
							</div>
						) : null}

						{tab === 'wordpress' ? (
							<div className="set-section">
								<div className="set-card">
									<h3>WordPress connections</h3>
									<p className="hint">Reconnect, disconnect, and sync from the Websites page — settings only mirrors status here.</p>
									{websites.length === 0 ? (
										<div className="set-empty mt-4">
											<div className="set-empty__art" aria-hidden="true" />
											<p className="font-semibold">No WordPress site linked</p>
											<p className="mt-1 text-sm text-muted-foreground">Connect a site to enable draft and live publishing.</p>
										</div>
									) : (
										<div className="mt-4 space-y-2">
											{websites.map((site) => (
												<div key={site.id} className="set-row">
													<div className="min-w-0 flex-1">
														<p className="truncate text-sm font-semibold">{site.name || site.domain}</p>
														<p className="text-xs text-muted-foreground">{site.url || 'No URL'}</p>
													</div>
													<Badge tone={site.status === 'connected' ? 'green' : 'amber'}>{site.status || 'unknown'}</Badge>
													<Link to="/app/websites"><Button size="sm" variant="outline"><RefreshCw size={13} /> Manage / Sync</Button></Link>
												</div>
											))}
										</div>
									)}
									<p className="mt-3 text-xs text-muted-foreground">Reconnect, Disconnect, and Sync Now stay on the Websites flow so backend behavior is unchanged.</p>
								</div>
							</div>
						) : null}

						{tab === 'pinterest' ? (
							<div className="set-section">
								<div className="set-card">
									<div className="mb-3 flex items-center justify-between gap-2">
										<div>
											<h3>Pinterest accounts</h3>
											<p className="hint">Connection status for publishing automation.</p>
										</div>
										<Link to="/app/pinterest"><Button size="sm" variant="outline">Open Pinterest Hub</Button></Link>
									</div>
									{pinterestAccounts.length === 0 ? (
										<div className="set-empty">
											<div className="set-empty__art" aria-hidden="true" />
											<p className="font-semibold">No Pinterest accounts</p>
											<p className="mt-1 text-sm text-muted-foreground">Connect an account in Pinterest Hub to schedule and publish pins.</p>
										</div>
									) : (
										<div className="space-y-2">
											{pinterestAccounts.map((account) => (
												<div key={account.id} className="set-row">
													<div className="set-row__avatar">
														{account.profileImageUrl ? (
															<img src={account.profileImageUrl} alt="" loading="lazy" decoding="async" />
														) : (
															<Pin size={14} className="text-muted-foreground" />
														)}
													</div>
													<div className="min-w-0 flex-1">
														<p className="truncate text-sm font-semibold">{account.label || account.accountName || account.username}</p>
														<p className="text-xs text-muted-foreground">
															Boards: {account.boardCount ?? '—'} · Last sync: {account.connectedAt ? new Date(account.connectedAt).toLocaleString() : '—'}
														</p>
													</div>
													<Badge tone={account.status === 'connected' ? 'green' : 'amber'}>{account.status || 'unknown'}</Badge>
												</div>
											))}
										</div>
									)}
									<p className="mt-3 text-xs text-muted-foreground">Reconnect and Disconnect remain in Pinterest Hub to preserve existing OAuth flows.</p>
								</div>
								<div className="set-card">
									<h3>Login with Pinterest</h3>
									<p className="hint">Separate from publishing OAuth — manage sign-in provider linking here.</p>
									<div className="mt-3">
										{(() => {
											const provider = OAUTH_PROVIDERS.pinterest;
											const connected = connectedProviders.has(provider.name);
											const supported = enabledProviders.size === 0 || enabledProviders.has(provider.name);
											return connected ? (
												<Button size="sm" variant="outline" disabled={providerAction === provider.name} onClick={() => handleDisconnectProvider(provider.name)}>
													{providerAction === provider.name ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink size={14} />} Disconnect login
												</Button>
											) : (
												<Button size="sm" disabled={!supported || providerAction === provider.name} onClick={() => handleConnectProvider(provider.name)}>
													{providerAction === provider.name ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 size={14} />} Connect login
												</Button>
											);
										})()}
									</div>
								</div>
							</div>
						) : null}

						{tab === 'notifications' ? (
							<div className="set-section">
								<div className="set-card">
									<h3>Notification preferences</h3>
									<p className="hint">Stored locally for this workspace until a notification service is connected.</p>
									<div className="mt-3">
										<SwitchRow label="Email notifications" checked={prefs.emailNotifications} onChange={(v) => updatePref('emailNotifications', v)} />
										<SwitchRow label="Publishing notifications" checked={prefs.publishingNotifications} onChange={(v) => updatePref('publishingNotifications', v)} />
										<SwitchRow label="Failure alerts" checked={prefs.failureAlerts} onChange={(v) => updatePref('failureAlerts', v)} />
										<SwitchRow label="Weekly reports" checked={prefs.weeklyReports} onChange={(v) => updatePref('weeklyReports', v)} />
										<SwitchRow label="Marketing emails" checked={prefs.marketingEmails} onChange={(v) => updatePref('marketingEmails', v)} />
									</div>
								</div>
							</div>
						) : null}

						{tab === 'security' ? (
							<div className="set-section">
								<div className="set-card">
									<h3>Change password</h3>
									<form className="mt-3 grid gap-3" onSubmit={changePassword}>
										<Input label="Current password" type="password" value={passwordForm.oldPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, oldPassword: e.target.value }))} />
										<Input label="New password" type="password" value={passwordForm.password} onChange={(e) => setPasswordForm((prev) => ({ ...prev, password: e.target.value }))} />
										<Input label="Confirm new password" type="password" value={passwordForm.passwordConfirm} onChange={(e) => setPasswordForm((prev) => ({ ...prev, passwordConfirm: e.target.value }))} />
										<Button type="submit" disabled={saving}><Shield size={14} /> Update password</Button>
									</form>
								</div>
								<div className="set-card">
									<h3>Two-factor authentication</h3>
									<p className="hint">2FA setup is not available in workspace settings yet.</p>
									<Button size="sm" className="mt-3" variant="outline" onClick={() => unavailable('Two-factor authentication')}>Enable 2FA</Button>
								</div>
								<div className="set-card">
									<h3>Active sessions</h3>
									<p className="hint">Current browser session for {user?.email}.</p>
									<div className="mt-3 set-row">
										<div className="min-w-0 flex-1">
											<p className="text-sm font-semibold">This device</p>
											<p className="text-xs text-muted-foreground">Signed in · {new Date().toLocaleString()}</p>
										</div>
										<Badge tone="green">active</Badge>
									</div>
									<div className="mt-3 flex flex-wrap gap-2">
										<Button size="sm" variant="outline" onClick={() => unavailable('Sign out other devices')}>Sign out other devices</Button>
										<Button size="sm" variant="ghost" onClick={logout}>Sign out this device</Button>
									</div>
								</div>
								<div className="set-card">
									<h3>Recent login activity</h3>
									<div className="set-empty mt-3">
										<p className="font-semibold">No activity feed yet</p>
										<p className="mt-1 text-sm text-muted-foreground">Login history will appear when the platform exposes session logs.</p>
									</div>
								</div>
							</div>
						) : null}

						{tab === 'appearance' ? (
							<div className="set-section">
								<div className="set-card space-y-3">
									<h3>Appearance</h3>
									<div>
										<p className="mb-1.5 text-sm font-medium">Theme</p>
										<div className="flex flex-wrap gap-2">
											<Button size="sm" variant={theme === 'light' ? 'primary' : 'outline'} onClick={() => ensureTheme('light')}>Light</Button>
											<Button size="sm" variant={theme === 'dark' ? 'primary' : 'outline'} onClick={() => ensureTheme('dark')}>Dark</Button>
										</div>
									</div>
									<Select label="Accent color" value={prefs.accentColor} onChange={(e) => updatePref('accentColor', e.target.value)}>
										<option value="coral">Warm coral (Chef IA)</option>
										<option value="amber">Amber</option>
										<option value="olive">Olive</option>
									</Select>
									<p className="text-[11px] text-muted-foreground -mt-2">Accent preference is stored locally; brand tokens still follow the atelier theme.</p>
									<Select label="Language" value={prefs.language} onChange={(e) => updatePref('language', e.target.value)}>
										{['English', 'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Dutch', 'Arabic'].map((lang) => (
											<option key={lang}>{lang}</option>
										))}
									</Select>
									<Select label="Date format" value={prefs.dateFormat} onChange={(e) => updatePref('dateFormat', e.target.value)}>
										<option value="locale">Locale default</option>
										<option value="mdy">MM/DD/YYYY</option>
										<option value="dmy">DD/MM/YYYY</option>
										<option value="ymd">YYYY-MM-DD</option>
									</Select>
									<Select label="Time format" value={prefs.timeFormat} onChange={(e) => updatePref('timeFormat', e.target.value)}>
										<option value="24h">24-hour</option>
										<option value="12h">12-hour</option>
									</Select>
								</div>
							</div>
						) : null}

						{tab === 'advanced' ? (
							<div className="set-section">
								<div className="set-card">
									<h3>Export / Import</h3>
									<p className="hint">Export local workspace preferences as JSON.</p>
									<div className="mt-3 flex flex-wrap gap-2">
										<Button size="sm" variant="outline" onClick={exportSettings}><Download size={14} /> Export Workspace</Button>
										<label className="inline-flex cursor-pointer">
											<span className="sr-only">Import settings</span>
											<input
												type="file"
												accept="application/json,.json"
												className="hidden"
												onChange={(e) => {
													importSettings(e.target.files?.[0]);
													e.target.value = '';
												}}
											/>
											<span className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-transparent px-3 py-1.5 text-xs font-medium transition-all hover:bg-secondary">
												<Upload size={14} /> Import Settings
											</span>
										</label>
										<Button size="sm" variant="ghost" onClick={resetPreferences}><RotateCcw size={14} /> Reset Preferences</Button>
									</div>
								</div>
								<div className="set-danger">
									<h4>Danger zone</h4>
									<p className="mt-1 text-sm text-muted-foreground">Delete workspace is not available from this page. Contact a platform administrator if you need account closure.</p>
									<Button size="sm" className="mt-3" variant="outline" onClick={() => unavailable('Delete workspace')}>
										<AlertTriangle size={14} /> Delete Workspace
									</Button>
								</div>
								<div className="set-managed">
									<strong>This workspace uses centrally managed AI services.</strong>
									OpenAI, Gemini, Claude, Fal.ai, SMTP, email provider keys, and Pinterest access tokens are not configurable here.
									<span className="mt-2 block text-muted-foreground">This setting is managed by the platform administrator.</span>
								</div>
							</div>
						) : null}
					</section>

					<aside className="set-side space-y-4">
						<div>
							<h2 className="font-display text-lg font-semibold">Workspace Summary</h2>
							<p className="text-[11px] text-muted-foreground">Plan, credits, and connections.</p>
						</div>
						<div className="set-summary">
							<div className="set-summary__row"><span>Current plan</span><strong>{user?.plan || 'free'}</strong></div>
							<div className="set-summary__row"><span className="inline-flex items-center gap-1"><Coins size={12} /> Credits</span><strong>~{creditsRemaining}/mo</strong></div>
							<div className="set-summary__row"><span className="inline-flex items-center gap-1"><HardDrive size={12} /> Storage</span><strong>—</strong></div>
							<div className="set-summary__row"><span>Websites</span><strong>{websites.length}</strong></div>
							<div className="set-summary__row"><span>Pinterest accounts</span><strong>{pinterestAccounts.length}</strong></div>
						</div>
						<div>
							<p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Quick links</p>
							<div className="set-links">
								<Link to="/app/subscription"><Crown size={14} /> Billing & Credits</Link>
								<Link to="/app/websites"><Globe size={14} /> Websites</Link>
								<Link to="/app/pinterest"><Pin size={14} /> Pinterest Hub</Link>
								<a href="https://docs.pocketbase.io" target="_blank" rel="noreferrer"><BookOpen size={14} /> Documentation</a>
								<a href="mailto:support@example.com"><LifeBuoy size={14} /> Support</a>
								<a href="mailto:hello@example.com"><Mail size={14} /> Contact</a>
							</div>
						</div>
					</aside>
				</div>
			)}
		</div>
	);
}
