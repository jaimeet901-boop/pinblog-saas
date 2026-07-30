import { Helmet } from 'react-helmet';
import { DEFAULT_FAVICON_HREF } from '@/components/PlatformFavicon';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';
import { resolveHttpUrl } from '@/lib/platformIdentity';
import { resolvePlatformSeo } from '@/lib/platformSeo';

/**
 * Central public metadata renderer (SEO Identity).
 * Omits blank tags; always emits a non-empty title via fallback chain.
 */
export default function PublicSeoHead({ overrides = {} }) {
	const identity = usePlatformIdentity();
	const seo = resolvePlatformSeo(identity, overrides);
	const faviconHref = resolveHttpUrl(identity.faviconUrl) || DEFAULT_FAVICON_HREF;

	return (
		<Helmet>
			<title>{seo.browserTitle}</title>
			{seo.metaDescription ? <meta name="description" content={seo.metaDescription} /> : null}
			{seo.metaKeywords ? <meta name="keywords" content={seo.metaKeywords} /> : null}
			{seo.canonicalUrl ? <link rel="canonical" href={seo.canonicalUrl} /> : null}

			{seo.ogTitle ? <meta property="og:title" content={seo.ogTitle} /> : null}
			{seo.ogDescription ? <meta property="og:description" content={seo.ogDescription} /> : null}
			{seo.ogImageUrl ? <meta property="og:image" content={seo.ogImageUrl} /> : null}
			{seo.canonicalUrl ? <meta property="og:url" content={seo.canonicalUrl} /> : null}
			<meta property="og:type" content={seo.ogType || 'website'} />
			<meta property="og:site_name" content={seo.platformName} />

			<meta name="twitter:card" content={seo.twitterCardType} />
			{seo.twitterTitle ? <meta name="twitter:title" content={seo.twitterTitle} /> : null}
			{seo.twitterDescription ? <meta name="twitter:description" content={seo.twitterDescription} /> : null}
			{seo.twitterImageUrl ? <meta name="twitter:image" content={seo.twitterImageUrl} /> : null}

			{seo.googleSiteVerification ? (
				<meta name="google-site-verification" content={seo.googleSiteVerification} />
			) : null}
			{seo.bingSiteVerification ? (
				<meta name="msvalidate.01" content={seo.bingSiteVerification} />
			) : null}
			{seo.pinterestSiteVerification ? (
				<meta name="p:domain_verify" content={seo.pinterestSiteVerification} />
			) : null}
			{seo.facebookDomainVerification ? (
				<meta name="facebook-domain-verification" content={seo.facebookDomainVerification} />
			) : null}

			<link rel="icon" href={faviconHref} />
		</Helmet>
	);
}
