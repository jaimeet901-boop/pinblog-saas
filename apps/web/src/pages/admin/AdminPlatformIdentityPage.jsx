import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, IdCard, Loader2, Save } from 'lucide-react';
import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import AssetUploader from '@/components/AssetUploader';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';
import './AdminPlatformIdentityPage.css';

const IDENTITY_SECTIONS = ['general', 'branding', 'domains', 'contact', 'seo', 'social'];

const BRAND_ASSETS = [
	{
		key: 'platformLogo',
		label: 'Platform Logo',
		description: 'Primary product logo used as the default brand mark.',
		maxSizeMB: 5,
	},
	{
		key: 'sidebarLogo',
		label: 'Sidebar Logo',
		description: 'App sidebar brand mark. Falls back to Platform Logo at runtime when empty.',
		maxSizeMB: 5,
	},
	{
		key: 'loginLogo',
		label: 'Login Logo',
		description: 'Auth / login brand mark. Falls back to Platform Logo when empty.',
		maxSizeMB: 5,
	},
	{
		key: 'favicon',
		label: 'Favicon',
		description: 'Browser tab icon (PNG / JPEG / WebP). Runtime link wiring may arrive later.',
		maxSizeMB: 2,
	},
	{
		key: 'openGraphImage',
		label: 'Open Graph Image',
		description: 'Default social share image (og:image / Twitter image fallback).',
		maxSizeMB: 5,
	},
];

const ASSET_URL_KEYS = {
	platformLogo: ['branding', 'platformLogoUrl'],
	sidebarLogo: ['branding', 'sidebarLogoUrl'],
	loginLogo: ['branding', 'loginLogoUrl'],
	favicon: ['branding', 'faviconUrl'],
	openGraphImage: ['seo', 'ogImageUrl'],
};

const IMAGE_ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];

function emptyAssetMeta() {
	return {
		url: '',
		fileName: '',
		fileSize: 0,
		width: null,
		height: null,
		updatedAt: null,
		recordId: '',
		mimeType: '',
	};
}

function resolveBrandAssetValue(identity, assetKey) {
	const [section, urlKey] = ASSET_URL_KEYS[assetKey] || [];
	const fromAssets = identity?.branding?.assets?.[assetKey];
	const url = String(
		(fromAssets && fromAssets.url)
		|| (section && identity?.[section]?.[urlKey])
		|| '',
	).trim();
	return {
		...emptyAssetMeta(),
		...(fromAssets && typeof fromAssets === 'object' ? fromAssets : {}),
		url,
	};
}

const EMPTY_IDENTITY = {
	general: {
		platformName: '',
		supportEmail: '',
		defaultLanguage: 'en',
		timezone: 'UTC',
	},
	branding: {
		platformLogoUrl: '',
		sidebarLogoUrl: '',
		loginLogoUrl: '',
		faviconUrl: '',
		assets: {},
	},
	domains: {
		primaryDomain: '',
		appUrl: '',
		apiUrl: '',
		documentationUrl: '',
	},
	contact: {
		contactEmail: '',
	},
	seo: {
		browserTitle: '',
		metaTitle: '',
		metaDescription: '',
		metaKeywords: '',
		canonicalUrl: '',
		ogTitle: '',
		ogDescription: '',
		ogImageUrl: '',
		twitterCardType: 'summary_large_image',
		twitterTitle: '',
		twitterDescription: '',
		twitterImageUrl: '',
		googleSiteVerification: '',
		bingSiteVerification: '',
		pinterestSiteVerification: '',
		facebookDomainVerification: '',
	},
	social: {
		facebook: '',
		twitter: '',
		linkedin: '',
		youtube: '',
		discord: '',
		github: '',
	},
};

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

function isValidHttpUrl(value) {
	const trimmed = String(value || '').trim();
	if (!trimmed) return true;
	try {
		const parsed = new URL(trimmed);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

function isValidEmail(value) {
	const trimmed = String(value || '').trim();
	if (!trimmed) return true;
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function isValidDomain(value) {
	const trimmed = String(value || '').trim();
	if (!trimmed) return true;
	return /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i.test(trimmed)
		|| isValidHttpUrl(trimmed);
}

function pickIdentity(settings = {}) {
	const next = structuredClone(EMPTY_IDENTITY);
	for (const section of IDENTITY_SECTIONS) {
		next[section] = {
			...next[section],
			...(settings[section] && typeof settings[section] === 'object' ? settings[section] : {}),
		};
	}
	// SoT: platformName + supportEmail live only under general.
	next.general.platformName = String(
		settings.general?.platformName
		|| settings.branding?.platformName
		|| '',
	).trim();
	next.general.supportEmail = String(
		settings.general?.supportEmail
		|| settings.contact?.supportEmail
		|| '',
	).trim();
	delete next.branding.platformName;
	delete next.contact.supportEmail;
	delete next.branding.openGraphImageUrl;
	next.branding.assets = {
		...(settings.branding?.assets && typeof settings.branding.assets === 'object'
			? settings.branding.assets
			: {}),
	};

	// Legacy SEO keys → SEO Identity SoT.
	next.seo.metaTitle = String(
		settings.seo?.metaTitle || settings.seo?.defaultMetaTitle || next.seo.metaTitle || '',
	).trim();
	next.seo.metaKeywords = String(
		settings.seo?.metaKeywords || settings.seo?.defaultKeywords || next.seo.metaKeywords || '',
	).trim();
	next.seo.ogImageUrl = String(
		settings.seo?.ogImageUrl || settings.branding?.openGraphImageUrl || next.seo.ogImageUrl || '',
	).trim();
	const card = String(next.seo.twitterCardType || '').trim().toLowerCase();
	next.seo.twitterCardType = card === 'summary' ? 'summary' : 'summary_large_image';
	delete next.seo.defaultMetaTitle;
	delete next.seo.defaultKeywords;

	return next;
}

function Field({ id, label, description, error, children }) {
	return (
		<div className={`admin-identity-field${error ? ' has-error' : ''}`}>
			<label htmlFor={id}>{label}</label>
			{description ? <p className="admin-identity-field__hint">{description}</p> : null}
			{children}
			{error ? <p className="admin-identity-field__error">{error}</p> : null}
		</div>
	);
}

function CollapsibleSection({
	id,
	title,
	subtitle,
	open,
	onToggle,
	children,
}) {
	return (
		<section className={`admin-card admin-identity-section${open ? ' is-open' : ''}`}>
			<button
				type="button"
				className="admin-identity-section__header"
				onClick={onToggle}
				aria-expanded={open}
				aria-controls={`identity-panel-${id}`}
			>
				<span>
					<strong>{title}</strong>
					{subtitle ? <span className="admin-identity-section__subtitle">{subtitle}</span> : null}
				</span>
				<ChevronDown size={16} aria-hidden="true" />
			</button>
			{open ? (
				<div id={`identity-panel-${id}`} className="admin-identity-section__body">
					{children}
				</div>
			) : null}
		</section>
	);
}

export default function AdminPlatformIdentityPage() {
	const { toast } = useToast();
	const [fullSettings, setFullSettings] = useState(null);
	const [identity, setIdentity] = useState(EMPTY_IDENTITY);
	const [savedSnapshot, setSavedSnapshot] = useState('');
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [meta, setMeta] = useState({ source: 'pocketbase' });
	const [errors, setErrors] = useState({});
	const [assetBusyKey, setAssetBusyKey] = useState('');
	const [openSections, setOpenSections] = useState({
		general: true,
		branding: true,
		domains: true,
		contact: false,
		seo: true,
		social: false,
	});

	const dirty = useMemo(
		() => JSON.stringify(identity) !== savedSnapshot,
		[identity, savedSnapshot],
	);

	const applyLoaded = useCallback((payload) => {
		const settings = payload.settings || payload;
		const nextIdentity = pickIdentity(settings);
		setFullSettings(settings);
		setIdentity(nextIdentity);
		setSavedSnapshot(JSON.stringify(nextIdentity));
		setErrors({});
		if (payload.meta) setMeta(payload.meta);
	}, []);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/settings');
			if (!response.ok) throw new Error(await readApiError(response));
			applyLoaded(await response.json());
		} catch (error) {
			toast({ variant: 'destructive', title: 'Identity load failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [applyLoaded, toast]);

	useEffect(() => {
		load();
	}, [load]);

	const uploadBrandAsset = async (assetKey, file, dimensions = {}) => {
		setAssetBusyKey(assetKey);
		try {
			const form = new FormData();
			form.append('file', file);
			if (dimensions.width) form.append('width', String(dimensions.width));
			if (dimensions.height) form.append('height', String(dimensions.height));

			const response = await apiServerClient.fetch(`/admin/v1/settings/brand-assets/${encodeURIComponent(assetKey)}`, {
				method: 'POST',
				body: form,
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			applyLoaded(payload);
			toast({ title: 'Asset uploaded', description: `${assetKey} is now live in Platform Identity.` });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Upload failed', description: error.message });
			throw error;
		} finally {
			setAssetBusyKey('');
		}
	};

	const removeBrandAsset = async (assetKey) => {
		setAssetBusyKey(assetKey);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/settings/brand-assets/${encodeURIComponent(assetKey)}`, {
				method: 'DELETE',
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			applyLoaded(payload);
			toast({ title: 'Asset removed', description: `${assetKey} was cleared from Platform Identity.` });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Remove failed', description: error.message });
			throw error;
		} finally {
			setAssetBusyKey('');
		}
	};

	const restoreBrandAsset = async (assetKey) => {
		setAssetBusyKey(assetKey);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/settings/brand-assets/${encodeURIComponent(assetKey)}/restore`, {
				method: 'POST',
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			applyLoaded(payload);
			toast({ title: 'Default restored', description: `${assetKey} was cleared. Runtime uses the built-in fallback.` });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Restore failed', description: error.message });
			throw error;
		} finally {
			setAssetBusyKey('');
		}
	};

	const patch = (section, key, value) => {
		setIdentity((prev) => ({
			...prev,
			[section]: {
				...prev[section],
				[key]: value,
			},
		}));
		setErrors((prev) => {
			const next = { ...prev };
			delete next[`${section}.${key}`];
			return next;
		});
	};

	const toggleSection = (section) => {
		setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
	};

	const validate = () => {
		const nextErrors = {};
		if (!String(identity.general?.platformName || '').trim()) {
			nextErrors['general.platformName'] = 'Platform name is required.';
		}

		const urlFields = [
			['domains', 'appUrl', 'App URL'],
			['domains', 'apiUrl', 'API URL'],
			['domains', 'documentationUrl', 'Documentation URL'],
			['seo', 'canonicalUrl', 'Canonical URL'],
			['seo', 'twitterImageUrl', 'Twitter Image URL'],
			['social', 'facebook', 'Facebook URL'],
			['social', 'twitter', 'X (Twitter) URL'],
			['social', 'linkedin', 'LinkedIn URL'],
			['social', 'youtube', 'YouTube URL'],
			['social', 'discord', 'Discord URL'],
			['social', 'github', 'GitHub URL'],
		];
		for (const [section, key, label] of urlFields) {
			if (!isValidHttpUrl(identity[section]?.[key])) {
				nextErrors[`${section}.${key}`] = `${label} must be a valid http(s) URL or empty.`;
			}
		}

		if (!isValidDomain(identity.domains?.primaryDomain)) {
			nextErrors['domains.primaryDomain'] = 'Primary domain must be a hostname (e.g. example.com) or empty.';
		}

		const emailFields = [
			['general', 'supportEmail', 'Support email'],
			['contact', 'contactEmail', 'Contact email'],
		];
		for (const [section, key, label] of emailFields) {
			const value = section === 'general' && key === 'supportEmail'
				? identity.general?.supportEmail
				: identity[section]?.[key];
			if (!isValidEmail(value)) {
				nextErrors[`${section}.${key}`] = `${label} must be a valid email or empty.`;
			}
		}

		const browserTitle = String(identity.seo?.browserTitle || '');
		if (browserTitle.length > 70) {
			nextErrors['seo.browserTitle'] = 'Browser title should be 70 characters or fewer.';
		}
		const metaTitle = String(identity.seo?.metaTitle || '');
		if (metaTitle.length > 70) {
			nextErrors['seo.metaTitle'] = 'Meta title should be 70 characters or fewer.';
		}
		const metaDescription = String(identity.seo?.metaDescription || '');
		if (metaDescription.length > 160) {
			nextErrors['seo.metaDescription'] = 'Meta description should be 160 characters or fewer.';
		}
		const ogTitle = String(identity.seo?.ogTitle || '');
		if (ogTitle.length > 70) {
			nextErrors['seo.ogTitle'] = 'OG title should be 70 characters or fewer.';
		}
		const ogDescription = String(identity.seo?.ogDescription || '');
		if (ogDescription.length > 200) {
			nextErrors['seo.ogDescription'] = 'OG description should be 200 characters or fewer.';
		}

		const card = String(identity.seo?.twitterCardType || '').trim().toLowerCase();
		if (card && card !== 'summary' && card !== 'summary_large_image') {
			nextErrors['seo.twitterCardType'] = 'Twitter card type must be summary or summary_large_image.';
		}

		setErrors(nextErrors);
		return Object.keys(nextErrors).length === 0;
	};

	const save = async () => {
		if (!fullSettings) {
			toast({ variant: 'destructive', title: 'Nothing to save', description: 'Load settings before saving.' });
			return;
		}
		if (!validate()) {
			toast({
				variant: 'destructive',
				title: 'Validation failed',
				description: 'Fix the highlighted fields before saving.',
			});
			return;
		}

		setSaving(true);
		try {
			const branding = {
				...identity.branding,
				assets: {
					...(identity.branding?.assets && typeof identity.branding.assets === 'object'
						? identity.branding.assets
						: {}),
				},
			};
			delete branding.platformName;
			delete branding.openGraphImageUrl;
			const contact = { ...identity.contact };
			delete contact.supportEmail;
			const seo = { ...identity.seo };
			delete seo.defaultMetaTitle;
			delete seo.defaultKeywords;

			const payload = {
				...fullSettings,
				general: {
					...(fullSettings.general || {}),
					...identity.general,
				},
				branding,
				domains: { ...identity.domains },
				contact,
				seo,
				social: { ...identity.social },
			};

			const response = await apiServerClient.fetch('/admin/v1/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ settings: payload }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			applyLoaded(await response.json());
			toast({ title: 'Platform Identity saved', description: 'Identity settings were stored in platform_settings.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Save failed', description: error.message });
		} finally {
			setSaving(false);
		}
	};

	const textInput = (section, key, {
		id, label, description, placeholder, type = 'text',
	}) => (
		<Field
			id={id}
			label={label}
			description={description}
			error={errors[`${section}.${key}`]}
		>
			<input
				id={id}
				type={type}
				value={identity[section]?.[key] ?? ''}
				placeholder={placeholder}
				onChange={(e) => patch(section, key, e.target.value)}
			/>
		</Field>
	);

	const textArea = (section, key, {
		id, label, description, placeholder, rows = 3,
	}) => (
		<Field
			id={id}
			label={label}
			description={description}
			error={errors[`${section}.${key}`]}
		>
			<textarea
				id={id}
				rows={rows}
				value={identity[section]?.[key] ?? ''}
				placeholder={placeholder}
				onChange={(e) => patch(section, key, e.target.value)}
			/>
		</Field>
	);

	return (
		<div className="admin-page admin-identity-page">
			<AdminHero
				eyebrow="Platform foundation"
				title="Platform Identity"
				description="Manage platform branding, domains, contact, SEO Identity, and social profiles. Public metadata resolves through inheritance chains."
				action={(
					<div className="flex flex-wrap items-center gap-2">
						<StatusPill status={dirty ? 'pending' : 'ok'} />
						<button type="button" className="admin-btn" onClick={save} disabled={loading || saving || !dirty}>
							{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
							Save Identity
						</button>
					</div>
				)}
			/>

			{loading ? (
				<div className="admin-card admin-identity-loading">
					<Loader2 className="animate-spin" size={18} />
					<span>Loading platform settings…</span>
				</div>
			) : (
				<>
					<section className="admin-card admin-identity-intro">
						<div className="admin-identity-intro__icon"><IdCard size={18} /></div>
						<div>
							<p className="admin-note mt-0 mb-1">
								Writes to the existing <code>platform_settings</code> payload via <code>PUT /admin/v1/settings</code>.
							</p>
							<p className="admin-note mt-0 mb-0">
								Source: {meta.source || 'pocketbase'} · Brand assets upload to PocketBase; Platform Name and Support Email stay single-source under General.
							</p>
						</div>
					</section>

					<CollapsibleSection
						id="general"
						title="General"
						subtitle="Canonical platform name and support email"
						open={openSections.general}
						onToggle={() => toggleSection('general')}
					>
						<div className="admin-settings-grid">
							{textInput('general', 'platformName', {
								id: 'general-platform-name',
								label: 'Platform Name',
								description: 'Single source of truth for the product display name (shell, auth, browser title).',
								placeholder: 'Seodeva',
							})}
							{textInput('general', 'supportEmail', {
								id: 'general-support-email',
								label: 'Support Email',
								description: 'Single source of truth for platform support contact. Also shown under Contact.',
								placeholder: 'support@example.com',
								type: 'email',
							})}
							{textInput('general', 'defaultLanguage', {
								id: 'general-default-language',
								label: 'Default Language',
								description: 'Default locale code for the platform (e.g. en).',
								placeholder: 'en',
							})}
							{textInput('general', 'timezone', {
								id: 'general-timezone',
								label: 'Timezone',
								description: 'Default IANA timezone for platform operations.',
								placeholder: 'UTC',
							})}
						</div>
					</CollapsibleSection>

					<CollapsibleSection
						id="branding"
						title="Branding"
						subtitle="Brand Asset Manager — upload, replace, remove"
						open={openSections.branding}
						onToggle={() => toggleSection('branding')}
					>
						<p className="admin-note mt-0 mb-3">
							Uploads store files in PocketBase and write the public URL into Platform Identity immediately.
							Runtime shell consumers keep using the same URL fields.
						</p>
						<div className="admin-identity-assets">
							{BRAND_ASSETS.map((asset) => (
								<AssetUploader
									key={asset.key}
									label={asset.label}
									description={asset.description}
									value={resolveBrandAssetValue(identity, asset.key)}
									accept={IMAGE_ACCEPT}
									maxSizeMB={asset.maxSizeMB}
									busy={assetBusyKey === asset.key}
									disabled={loading || saving || Boolean(assetBusyKey)}
									restoreDefaultDisabled={loading || saving || Boolean(assetBusyKey)}
									onUpload={(file, dimensions) => uploadBrandAsset(asset.key, file, dimensions)}
									onRemove={() => removeBrandAsset(asset.key)}
									onRestore={() => restoreBrandAsset(asset.key)}
								/>
							))}
						</div>
					</CollapsibleSection>

					<CollapsibleSection
						id="domains"
						title="Domains"
						subtitle="Public URLs and hosts"
						open={openSections.domains}
						onToggle={() => toggleSection('domains')}
					>
						<div className="admin-settings-grid">
							{textInput('domains', 'primaryDomain', {
								id: 'domains-primary',
								label: 'Primary Domain',
								description: 'Public hostname for the product (e.g. seodeva.com).',
								placeholder: 'example.com',
							})}
							{textInput('domains', 'appUrl', {
								id: 'domains-app-url',
								label: 'App URL',
								description: 'Public web app origin, including protocol.',
								placeholder: 'https://example.com',
							})}
							{textInput('domains', 'apiUrl', {
								id: 'domains-api-url',
								label: 'API URL',
								description: 'Public API base URL shown for operators and future clients.',
								placeholder: 'https://example.com/api',
							})}
							{textInput('domains', 'documentationUrl', {
								id: 'domains-docs-url',
								label: 'Documentation URL',
								description: 'Link to product documentation or help center.',
								placeholder: 'https://docs.example.com',
							})}
						</div>
					</CollapsibleSection>

					<CollapsibleSection
						id="contact"
						title="Contact"
						subtitle="Public support addresses"
						open={openSections.contact}
						onToggle={() => toggleSection('contact')}
					>
						<div className="admin-settings-grid">
							<Field
								id="contact-support-email"
								label="Support Email"
								description="Same setting as General → Support Email (single source of truth)."
								error={errors['general.supportEmail']}
							>
								<input
									id="contact-support-email"
									type="email"
									value={identity.general?.supportEmail ?? ''}
									placeholder="support@example.com"
									onChange={(e) => patch('general', 'supportEmail', e.target.value)}
								/>
							</Field>
							{textInput('contact', 'contactEmail', {
								id: 'contact-contact-email',
								label: 'Contact Email',
								description: 'General inquiries address (may differ from support).',
								placeholder: 'hello@example.com',
								type: 'email',
							})}
						</div>
					</CollapsibleSection>

					<CollapsibleSection
						id="seo"
						title="SEO Identity"
						subtitle="Browser, search, Open Graph, Twitter, and verification"
						open={openSections.seo}
						onToggle={() => toggleSection('seo')}
					>
						<div className="admin-identity-subgroup">
							<h4 className="admin-identity-subgroup__title">Browser</h4>
							<div className="admin-settings-grid">
								{textInput('seo', 'browserTitle', {
									id: 'seo-browser-title',
									label: 'Browser Title',
									description: 'Falls back to Meta Title → Platform Name when empty.',
									placeholder: 'Seodeva',
								})}
							</div>
						</div>

						<div className="admin-identity-subgroup">
							<h4 className="admin-identity-subgroup__title">Search</h4>
							<div className="admin-settings-grid">
								{textInput('seo', 'metaTitle', {
									id: 'seo-meta-title',
									label: 'Meta Title',
									description: 'Primary search title (recommended ≤ 70 characters). Falls back to Platform Name.',
									placeholder: 'Seodeva — AI content & Pinterest studio',
								})}
								{textArea('seo', 'metaDescription', {
									id: 'seo-meta-description',
									label: 'Meta Description',
									description: 'Search snippet description (recommended ≤ 160 characters).',
									placeholder: 'Create SEO articles and social creatives with Seodeva.',
								})}
								{textInput('seo', 'metaKeywords', {
									id: 'seo-keywords',
									label: 'Meta Keywords',
									description: 'Comma-separated keywords for default SEO metadata.',
									placeholder: 'ai writer, pinterest, seo, content studio',
								})}
								{textInput('seo', 'canonicalUrl', {
									id: 'seo-canonical',
									label: 'Canonical URL',
									description: 'Falls back to Domains → App URL when empty.',
									placeholder: 'https://example.com',
								})}
							</div>
						</div>

						<div className="admin-identity-subgroup">
							<h4 className="admin-identity-subgroup__title">Open Graph</h4>
							<div className="admin-settings-grid">
								{textInput('seo', 'ogTitle', {
									id: 'seo-og-title',
									label: 'OG Title',
									description: 'Falls back to Meta Title → Platform Name.',
									placeholder: 'Seodeva',
								})}
								{textArea('seo', 'ogDescription', {
									id: 'seo-og-description',
									label: 'OG Description',
									description: 'Falls back to Meta Description.',
									placeholder: 'Create, design, and publish with AI.',
								})}
								<p className="admin-note mt-0 mb-0" style={{ gridColumn: '1 / -1' }}>
									OG Image is managed in Branding → Brand Asset Manager (Open Graph Image).
								</p>
							</div>
						</div>

						<div className="admin-identity-subgroup">
							<h4 className="admin-identity-subgroup__title">Twitter / X</h4>
							<div className="admin-settings-grid">
								<Field
									id="seo-twitter-card"
									label="Twitter Card Type"
									description="summary or summary_large_image (default)."
									error={errors['seo.twitterCardType']}
								>
									<select
										id="seo-twitter-card"
										value={identity.seo?.twitterCardType || 'summary_large_image'}
										onChange={(e) => patch('seo', 'twitterCardType', e.target.value)}
									>
										<option value="summary_large_image">summary_large_image</option>
										<option value="summary">summary</option>
									</select>
								</Field>
								{textInput('seo', 'twitterTitle', {
									id: 'seo-twitter-title',
									label: 'Twitter Title',
									description: 'Falls back to OG Title → Meta Title.',
									placeholder: 'Seodeva',
								})}
								{textArea('seo', 'twitterDescription', {
									id: 'seo-twitter-description',
									label: 'Twitter Description',
									description: 'Falls back to OG Description → Meta Description.',
									placeholder: 'Create, design, and publish with AI.',
								})}
								{textInput('seo', 'twitterImageUrl', {
									id: 'seo-twitter-image',
									label: 'Twitter Image URL',
									description: 'Falls back to OG Image URL.',
									placeholder: 'https://cdn.example.com/twitter-card.png',
								})}
							</div>
						</div>

						<div className="admin-identity-subgroup">
							<h4 className="admin-identity-subgroup__title">Verification (prepare only)</h4>
							<p className="admin-note mt-0 mb-3">
								Stored now and injected as meta tags when non-empty. Full webmaster workflows arrive later.
							</p>
							<div className="admin-settings-grid">
								{textInput('seo', 'googleSiteVerification', {
									id: 'seo-google-verify',
									label: 'Google Search Console Verification',
									description: 'Content value for google-site-verification.',
									placeholder: 'verification-token',
								})}
								{textInput('seo', 'bingSiteVerification', {
									id: 'seo-bing-verify',
									label: 'Bing Webmaster Verification',
									description: 'Content value for msvalidate.01.',
									placeholder: 'verification-token',
								})}
								{textInput('seo', 'pinterestSiteVerification', {
									id: 'seo-pinterest-verify',
									label: 'Pinterest Verification',
									description: 'Content value for p:domain_verify.',
									placeholder: 'verification-token',
								})}
								{textInput('seo', 'facebookDomainVerification', {
									id: 'seo-facebook-verify',
									label: 'Facebook Domain Verification',
									description: 'Content value for facebook-domain-verification.',
									placeholder: 'verification-token',
								})}
							</div>
						</div>
					</CollapsibleSection>

					<CollapsibleSection
						id="social"
						title="Social"
						subtitle="Public profile links"
						open={openSections.social}
						onToggle={() => toggleSection('social')}
					>
						<div className="admin-settings-grid">
							{textInput('social', 'facebook', {
								id: 'social-facebook',
								label: 'Facebook',
								description: 'Official Facebook page URL.',
								placeholder: 'https://facebook.com/your-page',
							})}
							{textInput('social', 'twitter', {
								id: 'social-twitter',
								label: 'X (Twitter)',
								description: 'Official X / Twitter profile URL.',
								placeholder: 'https://x.com/your-handle',
							})}
							{textInput('social', 'linkedin', {
								id: 'social-linkedin',
								label: 'LinkedIn',
								description: 'Official LinkedIn company or profile URL.',
								placeholder: 'https://linkedin.com/company/your-company',
							})}
							{textInput('social', 'youtube', {
								id: 'social-youtube',
								label: 'YouTube',
								description: 'Official YouTube channel URL.',
								placeholder: 'https://youtube.com/@your-channel',
							})}
							{textInput('social', 'discord', {
								id: 'social-discord',
								label: 'Discord',
								description: 'Invite or community Discord URL.',
								placeholder: 'https://discord.gg/your-invite',
							})}
							{textInput('social', 'github', {
								id: 'social-github',
								label: 'GitHub',
								description: 'Official GitHub organization or repository URL.',
								placeholder: 'https://github.com/your-org',
							})}
						</div>
					</CollapsibleSection>
				</>
			)}
		</div>
	);
}
