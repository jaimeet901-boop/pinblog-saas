/**
 * Platform Identity helpers for shell + public consumers.
 * Fail-safe: empty/missing values preserve today's public UI.
 */

export const DEFAULT_PLATFORM_NAME = 'Chef IA';
export const DEFAULT_SUPPORT_EMAIL = 'support@tbuy.store';
export const DEFAULT_CONTACT_EMAIL = 'privacy@tbuy.store';
export const DEFAULT_SITE_URL = 'https://tbuy.store';

export const EMPTY_SEO_IDENTITY = {
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
};

export const PLATFORM_IDENTITY_DEFAULTS = {
	platformName: DEFAULT_PLATFORM_NAME,
	platformLogoUrl: '',
	sidebarLogoUrl: '',
	loginLogoUrl: '',
	faviconUrl: '',
	supportEmail: DEFAULT_SUPPORT_EMAIL,
	contactEmail: DEFAULT_CONTACT_EMAIL,
	siteUrl: DEFAULT_SITE_URL,
	documentationUrl: '',
	primaryDomain: '',
	appUrl: '',
	canonicalUrl: '',
	seo: { ...EMPTY_SEO_IDENTITY },
};

export function resolvePlatformName(value) {
	const name = String(value || '').trim();
	return name || DEFAULT_PLATFORM_NAME;
}

export function resolveLogoUrl(value) {
	const url = String(value || '').trim();
	if (!url) return '';
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
		return url;
	} catch {
		return '';
	}
}

export function resolveHttpUrl(value) {
	return resolveLogoUrl(value);
}

export function resolveEmail(value, fallback) {
	const email = String(value || '').trim();
	if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
	return fallback;
}

/**
 * Canonical public site origin for legal/canonical links.
 * Prefer appUrl → canonicalUrl → https://primaryDomain → DEFAULT_SITE_URL.
 */
export function resolveSiteUrl({
	appUrl = '',
	canonicalUrl = '',
	primaryDomain = '',
} = {}) {
	const fromApp = resolveHttpUrl(appUrl);
	if (fromApp) return fromApp.replace(/\/$/, '');

	const fromCanonical = resolveHttpUrl(canonicalUrl);
	if (fromCanonical) {
		try {
			const parsed = new URL(fromCanonical);
			return `${parsed.protocol}//${parsed.host}`;
		} catch {
			/* fall through */
		}
	}

	const domain = String(primaryDomain || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
	if (domain && /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i.test(domain)) {
		return `https://${domain}`;
	}

	return DEFAULT_SITE_URL;
}

export function mailtoHref(email) {
	const safe = String(email || '').trim();
	return safe ? `mailto:${safe}` : `mailto:${DEFAULT_SUPPORT_EMAIL}`;
}

function pickSeoSlice(source = {}) {
	const seo = source.seo && typeof source.seo === 'object' ? source.seo : {};
	const general = source.general && typeof source.general === 'object' ? source.general : {};
	const nested = general.seo && typeof general.seo === 'object' ? general.seo : {};
	const merged = { ...EMPTY_SEO_IDENTITY, ...seo, ...nested };

	return {
		browserTitle: String(merged.browserTitle || '').trim(),
		metaTitle: String(merged.metaTitle || merged.defaultMetaTitle || '').trim(),
		metaDescription: String(merged.metaDescription || '').trim(),
		metaKeywords: String(merged.metaKeywords || merged.defaultKeywords || '').trim(),
		canonicalUrl: String(merged.canonicalUrl || source.canonicalUrl || '').trim(),
		ogTitle: String(merged.ogTitle || '').trim(),
		ogDescription: String(merged.ogDescription || '').trim(),
		ogImageUrl: String(merged.ogImageUrl || source.openGraphImageUrl || '').trim(),
		twitterCardType: String(merged.twitterCardType || '').trim().toLowerCase() === 'summary'
			? 'summary'
			: 'summary_large_image',
		twitterTitle: String(merged.twitterTitle || '').trim(),
		twitterDescription: String(merged.twitterDescription || '').trim(),
		twitterImageUrl: String(merged.twitterImageUrl || '').trim(),
		googleSiteVerification: String(merged.googleSiteVerification || '').trim(),
		bingSiteVerification: String(merged.bingSiteVerification || '').trim(),
		pinterestSiteVerification: String(merged.pinterestSiteVerification || '').trim(),
		facebookDomainVerification: String(merged.facebookDomainVerification || '').trim(),
	};
}

export function pickPlatformIdentity(source = {}) {
	const general = source.general && typeof source.general === 'object' ? source.general : source;
	const domains = source.domains && typeof source.domains === 'object' ? source.domains : source;
	const contact = source.contact && typeof source.contact === 'object' ? source.contact : source;
	const seoSlice = pickSeoSlice(source);

	const appUrl = String(general?.appUrl || domains?.appUrl || source.appUrl || '').trim();
	const primaryDomain = String(general?.primaryDomain || domains?.primaryDomain || source.primaryDomain || '').trim();
	const canonicalUrl = String(seoSlice.canonicalUrl || general?.canonicalUrl || source.canonicalUrl || '').trim();
	const documentationUrl = resolveHttpUrl(
		general?.documentationUrl || domains?.documentationUrl || source.documentationUrl || '',
	);

	const supportEmail = resolveEmail(
		general?.supportEmail || source.supportEmail,
		DEFAULT_SUPPORT_EMAIL,
	);
	const contactEmail = resolveEmail(
		contact?.contactEmail || general?.contactEmail || source.contactEmail,
		DEFAULT_CONTACT_EMAIL,
	);

	return {
		platformName: resolvePlatformName(general?.platformName || source.platformName),
		platformLogoUrl: resolveLogoUrl(general?.platformLogoUrl || source.platformLogoUrl),
		sidebarLogoUrl: resolveLogoUrl(
			general?.sidebarLogoUrl || source.sidebarLogoUrl || general?.platformLogoUrl || source.platformLogoUrl,
		),
		loginLogoUrl: resolveLogoUrl(
			general?.loginLogoUrl || source.loginLogoUrl || general?.platformLogoUrl || source.platformLogoUrl,
		),
		faviconUrl: resolveLogoUrl(general?.faviconUrl || source.faviconUrl),
		supportEmail,
		contactEmail,
		siteUrl: resolveSiteUrl({ appUrl, canonicalUrl, primaryDomain }),
		documentationUrl,
		primaryDomain,
		appUrl: resolveHttpUrl(appUrl),
		canonicalUrl: resolveHttpUrl(canonicalUrl),
		seo: seoSlice,
	};
}

/**
 * Public footer links shared by Landing / Legal.
 * Docs is omitted when documentationUrl is empty (no blank href).
 */
export function buildPublicFooterLinks({
	supportEmail = DEFAULT_SUPPORT_EMAIL,
	contactEmail = DEFAULT_CONTACT_EMAIL,
	documentationUrl = '',
} = {}) {
	const links = [
		{ label: 'Privacy Policy', to: '/privacy' },
		{ label: 'Terms', to: '/terms' },
		{ label: 'Cookies', to: '/cookies' },
		{ label: 'Disclaimer', to: '/disclaimer' },
		{ label: 'Refunds', to: '/refund' },
		{ label: 'Support', href: mailtoHref(supportEmail) },
		{ label: 'Contact', href: mailtoHref(contactEmail) },
	];
	const docs = resolveHttpUrl(documentationUrl);
	if (docs) {
		links.push({ label: 'Documentation', href: docs, external: true });
	}
	return links;
}
