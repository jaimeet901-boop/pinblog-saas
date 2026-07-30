/**
 * Central SEO Identity resolver with inheritance (no duplicated values).
 *
 * Browser Title → Meta Title → Platform Name
 * OG Title → Meta Title → Platform Name
 * OG Description → Meta Description
 * Twitter Title → OG Title → Meta Title
 * Twitter Description → OG Description → Meta Description
 * Twitter Image → OG Image
 * Canonical → App URL
 */

import {
	pickPlatformIdentity,
	resolveHttpUrl,
	resolvePlatformName,
} from '@/lib/platformIdentity';

function firstNonEmpty(...values) {
	for (const value of values) {
		const trimmed = String(value || '').trim();
		if (trimmed) return trimmed;
	}
	return '';
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
	const ogImageUrl = resolveHttpUrl(firstNonEmpty(overrides.ogImageUrl, seo.ogImageUrl));

	const twitterTitle = firstNonEmpty(overrides.twitterTitle, seo.twitterTitle, ogTitle, metaTitle);
	const twitterDescription = firstNonEmpty(
		overrides.twitterDescription,
		seo.twitterDescription,
		ogDescription,
		metaDescription,
	);
	const twitterImageUrl = resolveHttpUrl(
		firstNonEmpty(overrides.twitterImageUrl, seo.twitterImageUrl, ogImageUrl),
	);
	const twitterCardType = firstNonEmpty(overrides.twitterCardType, seo.twitterCardType) === 'summary'
		? 'summary'
		: 'summary_large_image';

	const canonicalFromSeo = resolveHttpUrl(firstNonEmpty(overrides.canonicalUrl, seo.canonicalUrl));
	const appUrl = resolveHttpUrl(identity.appUrl);
	const canonicalUrl = (canonicalFromSeo || appUrl || identity.siteUrl || '').replace(/\/$/, '');

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
