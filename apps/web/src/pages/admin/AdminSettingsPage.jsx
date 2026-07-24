import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Save, RotateCcw, Upload, Download, Loader2,
} from 'lucide-react';
import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

function Field({ label, children }) {
	return (
		<div className="admin-field">
			<label>{label}</label>
			{children}
		</div>
	);
}

function TextInput({ label, value, onChange, type = 'text' }) {
	return (
		<Field label={label}>
			<input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
		</Field>
	);
}

function TextSelect({ label, value, onChange, options }) {
	return (
		<Field label={label}>
			<select value={value} onChange={(e) => onChange(e.target.value)}>
				{options.map((option) => (
					<option key={option.value ?? option} value={option.value ?? option}>
						{option.label ?? option}
					</option>
				))}
			</select>
		</Field>
	);
}

function ToggleRow({ label, checked, onChange }) {
	return (
		<label className="admin-settings-toggle">
			<span>{label}</span>
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
		</label>
	);
}

function Section({ title, children, hint }) {
	return (
		<section className="admin-card">
			<h3>{title}</h3>
			{hint ? <p className="admin-note mt-0 mb-3">{hint}</p> : null}
			{children}
		</section>
	);
}

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

const EMPTY = {
	general: {},
	ai: {},
	content: {},
	images: {},
	wordpress: {},
	pinterest: {},
	email: {},
	security: {},
	system: {},
	featureFlags: [],
	license: {},
};

export default function AdminSettingsPage() {
	const { toast } = useToast();
	const fileRef = useRef(null);
	const [settings, setSettings] = useState(EMPTY);
	const [savedSnapshot, setSavedSnapshot] = useState('');
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [meta, setMeta] = useState({ source: 'pocketbase' });

	const dirty = useMemo(
		() => JSON.stringify(settings) !== savedSnapshot,
		[settings, savedSnapshot],
	);

	const applyPayload = useCallback((payload) => {
		const next = payload.settings || payload;
		setSettings(next);
		setSavedSnapshot(JSON.stringify(next));
		if (payload.meta) setMeta(payload.meta);
	}, []);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/settings');
			if (!response.ok) throw new Error(await readApiError(response));
			applyPayload(await response.json());
		} catch (error) {
			toast({ variant: 'destructive', title: 'Settings load failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [applyPayload, toast]);

	useEffect(() => {
		load();
	}, [load]);

	const patch = (section, key, value) => {
		setSettings((prev) => ({
			...prev,
			[section]: {
				...prev[section],
				[key]: value,
			},
		}));
	};

	const patchFlag = (id, enabled) => {
		setSettings((prev) => ({
			...prev,
			featureFlags: (prev.featureFlags || []).map((flag) => (
				flag.id === id ? { ...flag, enabled } : flag
			)),
		}));
	};

	const save = async () => {
		setSaving(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ settings }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			applyPayload(await response.json());
			toast({ title: 'Settings saved', description: 'Platform configuration stored in PocketBase.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Save failed', description: error.message });
		} finally {
			setSaving(false);
		}
	};

	const reset = async () => {
		setSaving(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/settings/reset', { method: 'POST' });
			if (!response.ok) throw new Error(await readApiError(response));
			applyPayload(await response.json());
			toast({ title: 'Settings reset', description: 'Defaults restored and saved to PocketBase.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Reset failed', description: error.message });
		} finally {
			setSaving(false);
		}
	};

	const exportConfig = async () => {
		try {
			const response = await apiServerClient.fetch('/admin/v1/settings/export');
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const anchor = window.document.createElement('a');
			anchor.href = url;
			anchor.download = 'chef-ia-platform-settings.json';
			anchor.click();
			URL.revokeObjectURL(url);
			toast({ title: 'Exported', description: 'Configuration downloaded.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Export failed', description: error.message });
		}
	};

	const importConfig = async (file) => {
		if (!file) return;
		try {
			const text = await file.text();
			const document = JSON.parse(text);
			const response = await apiServerClient.fetch('/admin/v1/settings/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(document),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			applyPayload(await response.json());
			toast({ title: 'Imported', description: 'Configuration applied to PocketBase.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Import failed', description: error.message });
		}
	};

	if (loading) {
		return (
			<div>
				<AdminHero title="Global Platform Settings" description="Loading platform configuration…" />
				<p className="admin-note flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading settings…</p>
			</div>
		);
	}

	return (
		<div>
			<AdminHero
				title="Global Platform Settings"
				description="Configure platform-wide defaults, integrations and feature controls. Changes persist in PocketBase."
				action={(
					<div className="admin-analytics-controls">
						<button type="button" className="admin-btn" onClick={reset} disabled={saving}>
							<RotateCcw size={13} /> Reset
						</button>
						<button type="button" className="admin-btn" onClick={() => fileRef.current?.click()} disabled={saving}>
							<Upload size={13} /> Import Configuration
						</button>
						<input
							ref={fileRef}
							type="file"
							accept="application/json,.json"
							className="hidden"
							onChange={(e) => {
								importConfig(e.target.files?.[0]);
								e.target.value = '';
							}}
						/>
						<button type="button" className="admin-btn" onClick={exportConfig} disabled={saving}>
							<Download size={13} /> Export Configuration
						</button>
						<button type="button" className="admin-btn admin-btn--primary" onClick={save} disabled={saving || !dirty}>
							{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save Changes
						</button>
					</div>
				)}
			/>

			<p className="admin-note mt-0 mb-3">
				{dirty ? 'Unsaved edits · save to persist' : 'Synced with PocketBase'}
				{' · '}
				Source · {meta.source || 'pocketbase'}
				{meta.updatedAt ? ` · updated ${new Date(meta.updatedAt).toLocaleString()}` : ''}
			</p>

			<div className="admin-settings-grid">
				<Section title="General">
					<div className="admin-config-grid">
						<TextInput label="Platform Name" value={settings.general?.platformName} onChange={(value) => patch('general', 'platformName', value)} />
						<TextInput label="Support Email" value={settings.general?.supportEmail} onChange={(value) => patch('general', 'supportEmail', value)} />
						<TextSelect
							label="Default Language"
							value={settings.general?.defaultLanguage || 'en'}
							onChange={(value) => patch('general', 'defaultLanguage', value)}
							options={[
								{ value: 'en', label: 'English' },
								{ value: 'fr', label: 'French' },
								{ value: 'pt', label: 'Portuguese' },
								{ value: 'es', label: 'Spanish' },
							]}
						/>
						<TextSelect
							label="Timezone"
							value={settings.general?.timezone || 'UTC'}
							onChange={(value) => patch('general', 'timezone', value)}
							options={['UTC', 'Europe/Lisbon', 'Europe/Paris', 'America/New_York']}
						/>
						<TextSelect
							label="Date Format"
							value={settings.general?.dateFormat || 'YYYY-MM-DD'}
							onChange={(value) => patch('general', 'dateFormat', value)}
							options={['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']}
						/>
						<TextSelect
							label="Default Workspace Plan"
							value={settings.general?.defaultWorkspacePlan || 'free'}
							onChange={(value) => patch('general', 'defaultWorkspacePlan', value)}
							options={['free', 'starter', 'pro', 'business', 'enterprise']}
						/>
					</div>
					<div className="mt-2 space-y-2">
						<ToggleRow label="Maintenance Mode" checked={Boolean(settings.general?.maintenanceMode)} onChange={(value) => patch('general', 'maintenanceMode', value)} />
						<ToggleRow label="Allow Registration" checked={Boolean(settings.general?.allowRegistration)} onChange={(value) => patch('general', 'allowRegistration', value)} />
					</div>
				</Section>

				<Section title="AI Configuration">
					<div className="admin-config-grid">
						<TextSelect
							label="Default Provider"
							value={settings.ai?.defaultProvider || 'OpenAI'}
							onChange={(value) => patch('ai', 'defaultProvider', value)}
							options={['OpenAI', 'Google Gemini', 'Anthropic Claude', 'Fal.ai']}
						/>
						<TextInput label="Default Model" value={settings.ai?.defaultModel} onChange={(value) => patch('ai', 'defaultModel', value)} />
						<TextSelect
							label="Fallback Provider"
							value={settings.ai?.fallbackProvider || 'Google Gemini'}
							onChange={(value) => patch('ai', 'fallbackProvider', value)}
							options={['Google Gemini', 'OpenAI', 'DeepSeek', 'Mistral']}
						/>
						<TextInput label="Fallback Model" value={settings.ai?.fallbackModel} onChange={(value) => patch('ai', 'fallbackModel', value)} />
						<TextInput label="Temperature" value={settings.ai?.temperature} onChange={(value) => patch('ai', 'temperature', value)} />
						<TextInput label="Top P" value={settings.ai?.topP} onChange={(value) => patch('ai', 'topP', value)} />
						<TextInput label="Max Tokens" value={settings.ai?.maxTokens} onChange={(value) => patch('ai', 'maxTokens', value)} />
					</div>
					<div className="mt-2 space-y-2">
						<ToggleRow label="Streaming Enabled" checked={Boolean(settings.ai?.streamingEnabled)} onChange={(value) => patch('ai', 'streamingEnabled', value)} />
						<ToggleRow label="Reasoning enabled" checked={Boolean(settings.ai?.reasoningEnabled)} onChange={(value) => patch('ai', 'reasoningEnabled', value)} />
					</div>
				</Section>

				<Section title="Content Defaults">
					<div className="admin-config-grid">
						<TextInput label="Article Length" value={settings.content?.articleLength} onChange={(value) => patch('content', 'articleLength', value)} />
						<TextInput label="Recipe Style" value={settings.content?.recipeStyle} onChange={(value) => patch('content', 'recipeStyle', value)} />
					</div>
					<div className="mt-2 space-y-2">
						<ToggleRow label="SEO Enabled" checked={Boolean(settings.content?.seoEnabled)} onChange={(value) => patch('content', 'seoEnabled', value)} />
						<ToggleRow label="Auto Meta Description" checked={Boolean(settings.content?.autoMetaDescription)} onChange={(value) => patch('content', 'autoMetaDescription', value)} />
						<ToggleRow label="Auto Slug" checked={Boolean(settings.content?.autoSlug)} onChange={(value) => patch('content', 'autoSlug', value)} />
						<ToggleRow label="Auto Categories" checked={Boolean(settings.content?.autoCategories)} onChange={(value) => patch('content', 'autoCategories', value)} />
						<ToggleRow label="Auto Tags" checked={Boolean(settings.content?.autoTags)} onChange={(value) => patch('content', 'autoTags', value)} />
						<ToggleRow label="Internal Linking" checked={Boolean(settings.content?.internalLinking)} onChange={(value) => patch('content', 'internalLinking', value)} />
					</div>
				</Section>

				<Section title="Image Settings">
					<div className="admin-config-grid">
						<TextSelect
							label="Default Image Provider"
							value={settings.images?.defaultImageProvider || 'Fal.ai'}
							onChange={(value) => patch('images', 'defaultImageProvider', value)}
							options={['Fal.ai', 'OpenAI', 'Replicate']}
						/>
						<TextInput label="Default Image Model" value={settings.images?.defaultImageModel} onChange={(value) => patch('images', 'defaultImageModel', value)} />
						<TextInput label="Image Size" value={settings.images?.imageSize} onChange={(value) => patch('images', 'imageSize', value)} />
						<TextSelect
							label="Quality"
							value={settings.images?.quality || 'high'}
							onChange={(value) => patch('images', 'quality', value)}
							options={['standard', 'high', 'max']}
						/>
						<TextInput label="Storage Provider" value={settings.images?.storageProvider} onChange={(value) => patch('images', 'storageProvider', value)} />
						<TextInput label="Compression" value={settings.images?.compression} onChange={(value) => patch('images', 'compression', value)} />
					</div>
					<div className="mt-2">
						<ToggleRow label="Watermark" checked={Boolean(settings.images?.watermark)} onChange={(value) => patch('images', 'watermark', value)} />
					</div>
				</Section>

				<Section title="WordPress Defaults">
					<div className="admin-config-grid">
						<TextSelect
							label="Publishing Status"
							value={settings.wordpress?.publishingStatus || 'draft'}
							onChange={(value) => patch('wordpress', 'publishingStatus', value)}
							options={['draft', 'publish', 'pending']}
						/>
						<TextInput label="Retry Policy" value={settings.wordpress?.retryPolicy} onChange={(value) => patch('wordpress', 'retryPolicy', value)} />
						<TextInput label="Categories" value={settings.wordpress?.categories} onChange={(value) => patch('wordpress', 'categories', value)} />
						<TextInput label="Tags" value={settings.wordpress?.tags} onChange={(value) => patch('wordpress', 'tags', value)} />
					</div>
					<div className="mt-2 space-y-2">
						<ToggleRow label="Featured Image Required" checked={Boolean(settings.wordpress?.featuredImageRequired)} onChange={(value) => patch('wordpress', 'featuredImageRequired', value)} />
						<ToggleRow label="Auto Publish" checked={Boolean(settings.wordpress?.autoPublish)} onChange={(value) => patch('wordpress', 'autoPublish', value)} />
					</div>
				</Section>

				<Section title="Pinterest Defaults">
					<div className="admin-config-grid">
						<TextInput label="Default Board" value={settings.pinterest?.defaultBoard} onChange={(value) => patch('pinterest', 'defaultBoard', value)} />
						<TextSelect
							label="Scheduling"
							value={settings.pinterest?.scheduling || 'smart-slots'}
							onChange={(value) => patch('pinterest', 'scheduling', value)}
							options={['manual', 'smart-slots', 'immediate']}
						/>
						<TextInput label="Retry Policy" value={settings.pinterest?.retryPolicy} onChange={(value) => patch('pinterest', 'retryPolicy', value)} />
						<TextInput label="Pin Template" value={settings.pinterest?.pinTemplate} onChange={(value) => patch('pinterest', 'pinTemplate', value)} />
						<TextSelect
							label="Image Ratio"
							value={settings.pinterest?.imageRatio || '2:3'}
							onChange={(value) => patch('pinterest', 'imageRatio', value)}
							options={['1:1', '2:3', '9:16']}
						/>
						<TextInput
							label="Daily Limit"
							value={String(settings.pinterest?.dailyLimit ?? 50)}
							onChange={(value) => patch('pinterest', 'dailyLimit', Number(value) || 50)}
						/>
						<TextInput
							label="Publish Interval (minutes)"
							value={String(settings.pinterest?.intervalMinutes ?? 30)}
							onChange={(value) => patch('pinterest', 'intervalMinutes', Number(value) || 30)}
						/>
						<TextInput
							label="Publishing Window Start"
							value={settings.pinterest?.publishingWindows?.[0]?.start || '08:00'}
							onChange={(value) => patch('pinterest', 'publishingWindows', [{
								days: settings.pinterest?.publishingWindows?.[0]?.days || [0, 1, 2, 3, 4, 5, 6],
								start: value || '08:00',
								end: settings.pinterest?.publishingWindows?.[0]?.end || '20:00',
							}])}
						/>
						<TextInput
							label="Publishing Window End"
							value={settings.pinterest?.publishingWindows?.[0]?.end || '20:00'}
							onChange={(value) => patch('pinterest', 'publishingWindows', [{
								days: settings.pinterest?.publishingWindows?.[0]?.days || [0, 1, 2, 3, 4, 5, 6],
								start: settings.pinterest?.publishingWindows?.[0]?.start || '08:00',
								end: value || '20:00',
							}])}
						/>
					</div>
					<div className="mt-2">
						<ToggleRow
							label="Auto Publish"
							checked={Boolean(settings.pinterest?.autoPublish)}
							onChange={(value) => patch('pinterest', 'autoPublish', value)}
						/>
					</div>
				</Section>

				<Section title="Email Settings">
					<div className="admin-config-grid">
						<Field label="SMTP Status">
							<div className="pt-2"><StatusPill status={settings.email?.smtpStatus || 'pending'} /></div>
						</Field>
						<TextInput label="Sender Name" value={settings.email?.senderName} onChange={(value) => patch('email', 'senderName', value)} />
						<TextInput label="Sender Email" value={settings.email?.senderEmail} onChange={(value) => patch('email', 'senderEmail', value)} />
						<TextInput label="Daily Limit" value={settings.email?.dailyLimit} onChange={(value) => patch('email', 'dailyLimit', value)} />
						<TextInput label="Queue Limit" value={settings.email?.queueLimit} onChange={(value) => patch('email', 'queueLimit', value)} />
					</div>
				</Section>

				<Section title="Security">
					<div className="admin-config-grid">
						<TextInput label="Session Timeout" value={settings.security?.sessionTimeout} onChange={(value) => patch('security', 'sessionTimeout', value)} />
						<TextInput label="Password Policy" value={settings.security?.passwordPolicy} onChange={(value) => patch('security', 'passwordPolicy', value)} />
						<TextInput label="API Rate Limit" value={settings.security?.apiRateLimit} onChange={(value) => patch('security', 'apiRateLimit', value)} />
						<TextInput label="Allowed Origins" value={settings.security?.allowedOrigins} onChange={(value) => patch('security', 'allowedOrigins', value)} />
					</div>
					<div className="mt-2">
						<ToggleRow label="Require 2FA" checked={Boolean(settings.security?.require2fa)} onChange={(value) => patch('security', 'require2fa', value)} />
					</div>
				</Section>

				<Section title="System">
					<div className="admin-config-grid">
						<TextInput label="Log Retention" value={settings.system?.logRetention} onChange={(value) => patch('system', 'logRetention', value)} />
						<TextInput label="Backup Schedule" value={settings.system?.backupSchedule} onChange={(value) => patch('system', 'backupSchedule', value)} />
						<TextInput label="Cache TTL" value={settings.system?.cacheTtl} onChange={(value) => patch('system', 'cacheTtl', value)} />
						<TextInput label="Storage Limit" value={settings.system?.storageLimit} onChange={(value) => patch('system', 'storageLimit', value)} />
						<TextInput label="Default Region" value={settings.system?.defaultRegion} onChange={(value) => patch('system', 'defaultRegion', value)} />
					</div>
				</Section>

				<Section title="Feature Flags" hint="Feature flags are persisted with platform settings in PocketBase.">
					<div className="admin-settings-flags">
						{(settings.featureFlags || []).map((flag) => (
							<article key={flag.id} className="admin-settings-flag">
								<div>
									<strong>{flag.label}</strong>
									<p>{flag.enabled ? 'Enabled' : 'Disabled'}</p>
								</div>
								<input
									type="checkbox"
									checked={Boolean(flag.enabled)}
									onChange={(e) => patchFlag(flag.id, e.target.checked)}
									aria-label={`${flag.label} feature flag`}
								/>
							</article>
						))}
					</div>
				</Section>

				<Section title="License">
					<div className="admin-config-grid">
						<Field label="Current Version">
							<input value={settings.license?.currentVersion || ''} readOnly />
						</Field>
						<Field label="Build Number">
							<input value={settings.license?.buildNumber || ''} readOnly />
						</Field>
						<Field label="License Status">
							<div className="pt-2"><StatusPill status={settings.license?.licenseStatus === 'Active' ? 'healthy' : 'warn'} /></div>
						</Field>
						<TextSelect
							label="Release Channel"
							value={settings.license?.releaseChannel || 'stable'}
							onChange={(value) => setSettings((prev) => ({
								...prev,
								license: { ...prev.license, releaseChannel: value },
							}))}
							options={['stable', 'beta', 'canary']}
						/>
					</div>
				</Section>
			</div>

			<div className="mt-4 flex flex-wrap gap-2">
				<button type="button" className="admin-btn admin-btn--primary" onClick={save} disabled={saving || !dirty}>
					{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save Changes
				</button>
				<button type="button" className="admin-btn" onClick={reset} disabled={saving}>
					<RotateCcw size={13} /> Reset
				</button>
			</div>
		</div>
	);
}
