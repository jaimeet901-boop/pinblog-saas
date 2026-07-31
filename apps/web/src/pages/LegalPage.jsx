import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import PlatformBrandMark from '@/components/PlatformBrandMark';
import PublicSeoHead from '@/components/PublicSeoHead';
import apiServerClient from '@/lib/apiServerClient';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';
import { buildPublicFooterLinks } from '@/lib/platformIdentity';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { sanitizeRichHtml } from '@/lib/sanitizeHtml';
import './auth/AuthShell.css';
import './PrivacyPolicyPage.css';

const SLUG_FALLBACK_TITLE = {
	privacy: 'Privacy Policy',
	terms: 'Terms of Service',
	cookies: 'Cookie Policy',
	disclaimer: 'Disclaimer',
	refund: 'Refund Policy',
};

export default function LegalPage({ slug: slugProp }) {
	const params = useParams();
	const slug = String(slugProp || params.slug || '').toLowerCase();
	const {
		platformName,
		supportEmail,
		contactEmail,
		siteUrl,
		documentationUrl,
		loginLogoUrl,
		platformLogoUrl,
	} = usePlatformIdentity();
	const brandLogoUrl = loginLogoUrl || platformLogoUrl;
	const [page, setPage] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	const footerLinks = useMemo(() => buildPublicFooterLinks({
		supportEmail,
		contactEmail,
		documentationUrl,
	}), [supportEmail, contactEmail, documentationUrl]);

	useEffect(() => {
		window.scrollTo(0, 0);
		let cancelled = false;
		(async () => {
			setLoading(true);
			setError('');
			try {
				const response = await apiServerClient.fetch(`/legal/${encodeURIComponent(slug)}`);
				const payload = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(payload?.message || `Unable to load ${SLUG_FALLBACK_TITLE[slug] || 'page'}`);
				}
				if (!cancelled) setPage(payload);
			} catch (err) {
				if (!cancelled) {
					setPage(null);
					setError(err.message || 'Unable to load this page.');
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, [slug]);

	const html = useMemo(
		() => sanitizeRichHtml(renderMarkdownToHtml(page?.content || '')),
		[page?.content],
	);
	const pageTitle = page?.seoTitle || page?.title || SLUG_FALLBACK_TITLE[slug] || 'Legal';
	const seoOverrides = useMemo(() => ({
		browserTitle: pageTitle,
		metaTitle: pageTitle,
		metaDescription: page?.metaDescription || undefined,
		canonicalUrl: page?.canonicalUrl || `${siteUrl}/${slug}`,
	}), [pageTitle, page?.metaDescription, page?.canonicalUrl, siteUrl, slug]);

	return (
		<div className="welcome-atelier privacy-page text-foreground">
			<PublicSeoHead overrides={seoOverrides} />

			<header className="welcome-nav">
				<div className="mx-auto flex max-w-[76rem] items-center justify-between px-5 py-4">
					<Link to="/" className="auth-brand">
						<PlatformBrandMark
							logoUrl={brandLogoUrl}
							size={18}
							className="auth-brand__mark"
						/>
						<span className="auth-brand__name">{platformName}</span>
					</Link>
					<div className="flex items-center gap-2">
						<Link to="/login" className="rounded-xl px-4 py-2 text-sm font-medium hover:bg-secondary">Log in</Link>
						<Link to="/signup" className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
							Get started
						</Link>
					</div>
				</div>
			</header>

			<main className="privacy-main">
				<div className="privacy-hero">
					<Link to="/" className="privacy-back">
						<ArrowLeft size={14} /> Back to {platformName}
					</Link>
					<p className="auth-hero__eyebrow">Legal</p>
					<h1 className="privacy-title">{page?.title || SLUG_FALLBACK_TITLE[slug] || 'Legal'}</h1>
					{page?.updatedAt ? (
						<p className="privacy-meta">
							Last updated: {new Date(page.updatedAt).toLocaleDateString('en-US', {
								year: 'numeric',
								month: 'long',
								day: 'numeric',
							})}
							{page.version ? ` · Version ${page.version}` : ''}
						</p>
					) : null}
				</div>

				<article className="privacy-content privacy-content--solo">
					{loading ? (
						<p className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 size={14} className="animate-spin" /> Loading…
						</p>
					) : null}
					{!loading && error ? (
						<div>
							<p className="text-destructive">{error}</p>
							<p className="mt-3 text-sm text-muted-foreground">
								If this page should be available, publish it from Admin → Legal Pages or contact {supportEmail}.
							</p>
						</div>
					) : null}
					{!loading && !error ? (
						<div className="privacy-prose" dangerouslySetInnerHTML={{ __html: html }} />
					) : null}
				</article>
			</main>

			<footer className="border-t border-border/80">
				<div className="mx-auto flex max-w-[76rem] flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-2">
						<PlatformBrandMark
							logoUrl={brandLogoUrl}
							size={14}
							className="auth-brand__mark !h-8 !w-8"
						/>
						<span className="font-display font-semibold text-foreground">{platformName}</span>
					</div>
					<div className="auth-footer__links">
						{footerLinks.map((link) => (
							link.to
								? <Link key={link.label} to={link.to}>{link.label}</Link>
								: (
									<a
										key={link.label}
										href={link.href}
										{...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
									>
										{link.label}
									</a>
								)
						))}
					</div>
				</div>
			</footer>
		</div>
	);
}
