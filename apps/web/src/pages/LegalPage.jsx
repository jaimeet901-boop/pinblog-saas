import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { renderMarkdownToHtml } from '@/lib/markdown';
import './auth/AuthShell.css';
import './PrivacyPolicyPage.css';

const SITE_URL = 'https://tbuy.store';
const SUPPORT_EMAIL = 'support@tbuy.store';
const PRIVACY_EMAIL = 'privacy@tbuy.store';

const FOOTER_LINKS = [
	{ label: 'Privacy Policy', to: '/privacy' },
	{ label: 'Terms', to: '/terms' },
	{ label: 'Cookies', to: '/cookies' },
	{ label: 'Disclaimer', to: '/disclaimer' },
	{ label: 'Refunds', to: '/refund' },
	{ label: 'Support', href: `mailto:${SUPPORT_EMAIL}` },
	{ label: 'Contact', href: `mailto:${PRIVACY_EMAIL}` },
];

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
	const [page, setPage] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

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

	const html = useMemo(() => renderMarkdownToHtml(page?.content || ''), [page?.content]);
	const title = page?.seoTitle || page?.title || SLUG_FALLBACK_TITLE[slug] || 'Legal';
	const description = page?.metaDescription
		|| 'Chef IA legal information for accounts, workspaces, publishing integrations, and AI features.';
	const canonical = page?.canonicalUrl || `${SITE_URL}/${slug}`;

	return (
		<div className="welcome-atelier privacy-page text-foreground">
			<Helmet>
				<title>{title}</title>
				<meta name="description" content={description} />
				<link rel="canonical" href={canonical} />
				<meta property="og:title" content={title} />
				<meta property="og:description" content={description} />
				<meta property="og:url" content={canonical} />
				<meta property="og:type" content="website" />
			</Helmet>

			<header className="welcome-nav">
				<div className="mx-auto flex max-w-[76rem] items-center justify-between px-5 py-4">
					<Link to="/" className="auth-brand">
						<span className="auth-brand__mark"><Sparkles size={18} /></span>
						<span className="auth-brand__name">Chef IA</span>
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
						<ArrowLeft size={14} /> Back to Chef IA
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
								If this page should be available, publish it from Admin → Legal Pages or contact {SUPPORT_EMAIL}.
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
						<span className="auth-brand__mark !h-8 !w-8"><Sparkles size={14} /></span>
						<span className="font-display font-semibold text-foreground">Chef IA</span>
					</div>
					<div className="auth-footer__links">
						{FOOTER_LINKS.map((link) => (
							link.to
								? <Link key={link.label} to={link.to}>{link.label}</Link>
								: <a key={link.label} href={link.href}>{link.label}</a>
						))}
					</div>
				</div>
			</footer>
		</div>
	);
}
