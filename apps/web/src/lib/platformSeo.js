/**
 * Central SEO Identity resolver with inheritance (no duplicated values).
 *
 * Browser Title → Meta Title → Platform Name
 * OG Title → Meta Title → Platform Name
 * OG Description → Meta Description
 * Twitter Title → OG Title → Meta Title
 * Twitter Description → OG Description → Meta Description
 * Twitter Image → OG Image
 * Canonical → App URL (+ optional path)
 */

import {
	DEFAULT_SITE_URL,
	pickPlatformIdentity,
	resolveHttpUrl,
	resolvePlatformName,
	resolveSiteUrl,
} from '@/lib/platformIdentity';
import { R0_OG_IMAGE_PATH } from '@/lib/marketing/r0Copy';

function firstNonEmpty(...values) {
	for (const value of values) {
		const trimmed = String(value || '').trim();
		if (trimmed) return trimmed;
	}
	return '';
}

/**
 * Join origin + path into a canonical URL (no trailing slash except root).
 * @param {string} origin
 * @param {string} [path]
 */
export function joinCanonicalUrl(origin, path = '/') {
	const base = String(origin || '').replace(/\/$/, '');
	if (!base) return '';
	const cleanPath = String(path || '/').trim() || '/';
	if (cleanPath === '/') return base;
	const normalized = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
	return `${base}${normalized.replace(/\/$/, '')}`;
}

/**
 * Resolve absolute asset URL for public files (e.g. /og-chef-ia.png).
 */
export function resolvePublicAssetUrl(origin, assetPath) {
	const path = String(assetPath || '').trim();
	if (!path) return '';
	const absolute = resolveHttpUrl(path);
	if (absolute) return absolute;
	const base = String(origin || '').replace(/\/$/, '') || DEFAULT_SITE_URL;
	const normalized = path.startsWith('/') ? path : `/${path}`;
	return `${base}${normalized}`;
}

/**
 * Build Helmet overrides for a locked R0 page SEO entry.
 * @param {object} pageSeo - from R0_PAGE_SEO.*
 * @param {object} [identity]
 */
export function buildPageSeoOverrides(pageSeo = {}, identity = {}) {
	const siteOrigin = resolveSiteUrl({
		appUrl: identity.appUrl,
		canonicalUrl: identity.canonicalUrl || identity.seo?.canonicalUrl,
		primaryDomain: identity.primaryDomain,
	}) || DEFAULT_SITE_URL;

	const path = pageSeo.path || '/';
	const ogImageUrl = resolvePublicAssetUrl(
		siteOrigin,
		firstNonEmpty(identity.seo?.ogImageUrl, R0_OG_IMAGE_PATH),
	);

	return {
		metaTitle: pageSeo.metaTitle,
		browserTitle: pageSeo.browserTitle || pageSeo.metaTitle,
		metaDescription: pageSeo.metaDescription,
		ogTitle: pageSeo.ogTitle || pageSeo.metaTitle,
		ogDescription: pageSeo.ogDescription || pageSeo.metaDescription,
		twitterTitle: pageSeo.twitterTitle || pageSeo.metaTitle,
		twitterDescription: pageSeo.twitterDescription || pageSeo.ogDescription || pageSeo.metaDescription,
		canonicalUrl: joinCanonicalUrl(siteOrigin, path),
		canonicalPath: path,
		ogImageUrl,
		twitterImageUrl: ogImageUrl,
		ogType: 'website',
	};
}

/**
 * @param {object} identity - from usePlatformIdentity() / pickPlatformIdentity()
 * @param {object} [overrides] - page-level values (Legal CMS, etc.)
 */
export function resolvePlatformSeo(identityInput = {}, overrides = {}) {
	const identity = identityInput?.seo
		? identityInput
		: pickPlatformIdentity(identityInput);
	const seo = identity.seo || {};
	const platformName = resolvePlatformName(identity.platformName);

	const metaTitle = firstNonEmpty(overrides.metaTitle, seo.metaTitle, platformName);
	const browserTitle = firstNonEmpty(overrides.browserTitle, seo.browserTitle, metaTitle, platformName);
	const metaDescription = firstNonEmpty(overrides.metaDescription, seo.metaDescription);
	const metaKeywords = firstNonEmpty(overrides.metaKeywords, seo.metaKeywords);

	const ogTitle = firstNonEmpty(overrides.ogTitle, seo.ogTitle, metaTitle, platformName);
	const ogDescription = firstNonEmpty(overrides.ogDescription, seo.ogDescription, metaDescription);

	const siteOrigin = resolveSiteUrl({
		appUrl: identity.appUrl,
		canonicalUrl: identity.canonicalUrl || seo.canonicalUrl,
		primaryDomain: identity.primaryDomain,
	}) || DEFAULT_SITE_URL;

	const ogImageUrl = firstNonEmpty(
		resolveHttpUrl(firstNonEmpty(overrides.ogImageUrl, seo.ogImageUrl)),
		resolvePublicAssetUrl(siteOrigin, R0_OG_IMAGE_PATH),
	);

	const twitterTitle = firstNonEmpty(overrides.twitterTitle, seo.twitterTitle, ogTitle, metaTitle);
	const twitterDescription = firstNonEmpty(
		overrides.twitterDescription,
		seo.twitterDescription,
		ogDescription,
		metaDescription,
	);
	const twitterImageUrl = firstNonEmpty(
		resolveHttpUrl(firstNonEmpty(overrides.twitterImageUrl, seo.twitterImageUrl)),
		ogImageUrl,
	);
	const twitterCardType = firstNonEmpty(overrides.twitterCardType, seo.twitterCardType) === 'summary'
		? 'summary'
		: 'summary_large_image';

	const canonicalFromOverride = resolveHttpUrl(overrides.canonicalUrl);
	const canonicalFromSeo = resolveHttpUrl(seo.canonicalUrl);
	const originFallback = resolveHttpUrl(identity.appUrl) || siteOrigin;
	let canonicalUrl = (canonicalFromOverride || canonicalFromSeo || originFallback || '').replace(/\/$/, '');

	if (overrides.canonicalPath && !canonicalFromOverride) {
		canonicalUrl = joinCanonicalUrl(canonicalUrl || siteOrigin, overrides.canonicalPath);
	}

	return {
		platformName,
		browserTitle,
		metaTitle,
		metaDescription,
		metaKeywords,
		canonicalUrl,
		ogTitle,
		ogDescription,
		ogImageUrl,
		ogType: firstNonEmpty(overrides.ogType, 'website'),
		twitterCardType,
		twitterTitle,
		twitterDescription,
		twitterImageUrl,
		googleSiteVerification: firstNonEmpty(overrides.googleSiteVerification, seo.googleSiteVerification),
		bingSiteVerification: firstNonEmpty(overrides.bingSiteVerification, seo.bingSiteVerification),
		pinterestSiteVerification: firstNonEmpty(
			overrides.pinterestSiteVerification,
			seo.pinterestSiteVerification,
		),
		facebookDomainVerification: firstNonEmpty(
			overrides.facebookDomainVerification,
			seo.facebookDomainVerification,
		),
	};
}
