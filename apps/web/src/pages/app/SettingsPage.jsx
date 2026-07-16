import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Link2, Loader2, Save, Unlink } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Card, PageHeader, Button, Input, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { OAUTH_PROVIDERS, getEnabledProviderNames, normalizePocketBaseError } from '@/lib/auth';
import { useAuth } from '@/context/AuthContext';

const FIELDS = [
	{ k: 'openai_key', label: 'OpenAI API Key', ph: 'sk-…' },
	{ k: 'gemini_key', label: 'Gemini API Key', ph: 'AIza…' },
	{ k: 'fal_key', label: 'Fal.ai API Key', ph: 'fal-…' },
	{ k: 'pinterest_token', label: 'Pinterest Access Token', ph: 'pina_…' },
	{ k: 'email_from', label: 'Email "From" Address', ph: 'hello@myblog.com', type: 'email' },
];

export default function SettingsPage() {
	const { toast } = useToast();
	const { user, authMethods, externalAuths, connectProvider, disconnectProvider } = useAuth();
	const [form, setForm] = useState({});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [hasOpenAIKey, setHasOpenAIKey] = useState(false);
	const [providerAction, setProviderAction] = useState('');

	const enabledProviders = useMemo(() => getEnabledProviderNames(authMethods), [authMethods]);
	const connectedProviders = useMemo(() => new Set((externalAuths || []).map((item) => item.provider)), [externalAuths]);

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

	useEffect(() => {
		(async () => {
			try {
				const response = await apiServerClient.fetch('/settings', { method: 'GET' });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(payload?.message || 'Failed to load settings');
				}
				setForm(payload);
				setHasOpenAIKey(Boolean(payload?.has_openai_key));
			} catch (error) {
				toast({ variant: 'destructive', title: 'Error', description: error?.message });
			} finally {
				setLoading(false);
			}
		})();
	}, []);

	const save = async (e) => {
		e.preventDefault();
		setSaving(true);
		const payload = { openai_key: form.openai_key || '', gemini_key: form.gemini_key || '', fal_key: form.fal_key || '', pinterest_token: form.pinterest_token || '', email_from: form.email_from || '' };
		try {
			const response = await apiServerClient.fetch('/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(data?.message || 'Failed to save settings');
			}
			setForm(data);
			setHasOpenAIKey(Boolean(data?.has_openai_key));
			toast({ title: 'Settings saved' });
		} catch (err) { toast({ variant: 'destructive', title: 'Error', description: err?.message }); }
		finally { setSaving(false); }
	};

	if (loading) return <div className="flex justify-center py-16"><Spinner className="text-primary" /></div>;

	return (
		<div>
			<PageHeader title="Settings" subtitle="Manage your API keys and integrations." />
			<div className="space-y-6">
				<Card className="max-w-3xl">
					<div className="mb-4 flex items-center gap-2">
						<Link2 size={18} className="text-primary" />
						<h3 className="font-semibold">Connected Accounts</h3>
					</div>
					<p className="mb-5 text-sm text-muted-foreground">Link Google or Pinterest to sign in faster, keep providers in sync, and manage existing external auth connections.</p>
					<div className="grid gap-3 md:grid-cols-2">
						{Object.values(OAUTH_PROVIDERS).map((provider) => {
							const connected = connectedProviders.has(provider.name);
							const supported = enabledProviders.size === 0 || enabledProviders.has(provider.name);
							return (
								<div key={provider.name} className="rounded-2xl border border-border/80 bg-secondary/20 p-4">
									<div className="flex items-start justify-between gap-3">
										<div>
											<p className="font-medium">{provider.label}</p>
											<p className="mt-1 text-sm text-muted-foreground">{provider.description}</p>
										</div>
										<Badge tone={connected ? 'green' : 'amber'}>{connected ? 'connected' : 'not connected'}</Badge>
									</div>
									<div className="mt-4 flex flex-wrap gap-2">
										{connected ? (
											<Button
												size="sm"
												variant="outline"
												disabled={providerAction === provider.name}
												onClick={() => handleDisconnectProvider(provider.name)}
											>
												{providerAction === provider.name ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink size={14} />} Disconnect {provider.label}
											</Button>
										) : (
											<Button
												size="sm"
												disabled={!supported || providerAction === provider.name}
												onClick={() => handleConnectProvider(provider.name)}
											>
												{providerAction === provider.name ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 size={14} />} Connect {provider.label}
											</Button>
										)}
										{!supported ? <p className="mt-2 text-xs text-muted-foreground">Enable {provider.label} OAuth2 in PocketBase to use this action.</p> : null}
									</div>
								</div>
							);
						})}
					</div>
					{user?.id ? <p className="mt-4 text-xs text-muted-foreground">Signed in as {user.email}</p> : null}
				</Card>

				<Card className="max-w-2xl">
					<div className="mb-4 flex items-center gap-2">
						<KeyRound size={18} className="text-primary" />
						<h3 className="font-semibold">API keys & integrations</h3>
					</div>
					<p className="mb-5 text-sm text-muted-foreground">Keys are stored securely and used only for your account's generations.</p>
					{hasOpenAIKey ? <p className="mb-4 text-xs text-emerald-600">OpenAI API key is configured securely.</p> : null}
					<form onSubmit={save} className="space-y-4">
						{FIELDS.map((f) => (
							<Input key={f.k} label={f.label} type={f.type || 'password'} value={form[f.k] || ''} placeholder={f.ph}
								onChange={(e) => setForm((s) => ({ ...s, [f.k]: e.target.value }))} />
						))}
						<Button type="submit" disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save settings'}</Button>
					</form>
				</Card>
			</div>
		</div>
	);
}
