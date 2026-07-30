import { Router } from 'express';
import { getPublishedLegalPageBySlug, LEGAL_PAGE_SLUGS } from '../services/legal-pages.js';
import { getPublicPlatformIdentity } from '../services/platform-settings.js';

const router = Router();
const FALLBACK_SITE_URL = 'https://tbuy.store';

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

function resolvePublicSiteUrl(identity) {
	const appUrl = String(identity?.appUrl || '').trim().replace(/\/$/, '');
	if (/^https?:\/\//i.test(appUrl)) return appUrl;
	const canonical = String(identity?.canonicalUrl || '').trim();
	if (/^https?:\/\//i.test(canonical)) {
		try {
			const parsed = new URL(canonical);
			return `${parsed.protocol}//${parsed.host}`;
		} catch {
			/* fall through */
		}
	}
	const domain = String(identity?.primaryDomain || '').trim()
		.replace(/^https?:\/\//i, '')
		.replace(/\/$/, '');
	if (domain) return `https://${domain}`;
	return FALLBACK_SITE_URL;
}

router.get('/', asyncHandler(async (_req, res) => {
	const identity = await getPublicPlatformIdentity().catch(() => null);
	const siteUrl = resolvePublicSiteUrl(identity);
	res.json({
		items: LEGAL_PAGE_SLUGS.map((slug) => ({
			slug,
			path: `/${slug}`,
			url: `${siteUrl}/${slug}`,
		})),
	});
}));

router.get('/:slug', asyncHandler(async (req, res) => {
	res.json(await getPublishedLegalPageBySlug(req.params.slug));
}));

export default router;
