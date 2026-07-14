import { useEffect, useState } from 'react';
import { KeyRound, Save } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Card, PageHeader, Button, Input, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';

const FIELDS = [
	{ k: 'openai_key', label: 'OpenAI API Key', ph: 'sk-…' },
	{ k: 'gemini_key', label: 'Gemini API Key', ph: 'AIza…' },
	{ k: 'fal_key', label: 'Fal.ai API Key', ph: 'fal-…' },
	{ k: 'pinterest_token', label: 'Pinterest Access Token', ph: 'pina_…' },
	{ k: 'email_from', label: 'Email "From" Address', ph: 'hello@myblog.com', type: 'email' },
];

export default function SettingsPage() {
	const { toast } = useToast();
	const [form, setForm] = useState({});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [hasOpenAIKey, setHasOpenAIKey] = useState(false);

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
	);
}
