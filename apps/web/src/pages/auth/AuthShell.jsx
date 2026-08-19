import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
	PenLine,
	Palette,
	Pin,
	Facebook,
	Send,
	CalendarDays,
	BarChart3,
	CheckCircle2,
} from 'lucide-react';
import PlatformBrandMark from '@/components/PlatformBrandMark';
import PublicSeoHead from '@/components/PublicSeoHead';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';
import { buildPublicFooterLinks } from '@/lib/platformIdentity';
import { buildPageSeoOverrides } from '@/lib/platformSeo';
import {
	R0_HERO,
	R0_PAGE_SEO,
	R0_ONBOARDING,
	R0_CHANNELS,
	R0_FOOTER,
	R0_POSITION,
} from '@/lib/marketing/r0Copy';
import './AuthShell.css';

const ICON = { size: 14, strokeWidth: 1.75 };

const AUTH_FEATURE_CHIPS = [
	{ icon: PenLine, title: 'AI Writer' },
	{ icon: Palette, title: 'Brand Kit' },
	{ icon: Pin, title: 'Pinterest Hub' },
	{ icon: Facebook, title: 'Facebook Hub' },
	{ icon: Send, title: 'Publishing Center' },
	{ icon: CalendarDays, title: 'Unified Calendar' },
	{ icon: BarChart3, title: 'Analytics' },
];

export default function AuthShell({ title, subtitle, children, footer, seoPage = 'login' }) {
	const identity = usePlatformIdentity();
	const {
		platformName,
		loginLogoUrl,
		platformLogoUrl,
		supportEmail,
		contactEmail,
		documentationUrl,
	} = identity;
	const logoUrl = loginLogoUrl || platformLogoUrl;
	const footerLinks = useMemo(() => buildPublicFooterLinks({
		supportEmail,
		contactEmail,
		documentationUrl,
	}), [supportEmail, contactEmail, documentationUrl]);

	const seoOverrides = useMemo(() => {
		const pageKey = seoPage === 'signup' ? 'signup' : 'login';
		return buildPageSeoOverrides(R0_PAGE_SEO[pageKey], identity);
	}, [seoPage, identity]);

	return (
		<div className="auth-atelier">
			<PublicSeoHead overrides={seoOverrides} />
			<a href="#main-content" className="skip-link">Skip to main content</a>

			<aside className="auth-hero" aria-label={`${platformName} product story`}>
				<span className="auth-hero__glow auth-hero__glow--a" aria-hidden="true" />
				<span className="auth-hero__glow auth-hero__glow--b" aria-hidden="true" />
				<span className="auth-hero__glow auth-hero__glow--c" aria-hidden="true" />

				<header className="auth-hero__brand">
					<Link to="/" className="auth-brand">
						<PlatformBrandMark logoUrl={logoUrl} size={18} className="auth-brand__mark" />
						<span className="auth-brand__name">{platformName}</span>
					</Link>
				</header>

				<div className="auth-hero__copy">
					<p className="auth-hero__position">{R0_POSITION}</p>
					{/* Visual headline only — form owns the page <h1> for hierarchy */}
					<p className="auth-hero__title">{R0_HERO.headline}</p>
					<p className="auth-hero__desc">{R0_HERO.subheadline}</p>
				</div>

				<div className="auth-features">
					{AUTH_FEATURE_CHIPS.map(({ icon: Icon, title: featureTitle }) => (
						<div key={featureTitle} className="auth-feature">
							<span className="auth-feature__icon" aria-hidden="true"><Icon {...ICON} /></span>
							<p className="auth-feature__title">{featureTitle}</p>
						</div>
					))}
				</div>

				<div className="auth-mock" aria-hidden="true">
					<div className="auth-mock__stage">
						<div className="auth-mock__blur" />
						<div className="auth-mock__panels">
							<div className="auth-mock__panel">
								<strong>Unified Calendar</strong>
								<div className="auth-mock__cal">
									<span className="is-busy" /><span /><span className="is-busy" /><span /><span className="is-busy" /><span /><span />
								</div>
							</div>
							<div className="auth-mock__panel">
								<strong>Analytics</strong>
								<div className="auth-mock__spark">
									<span /><span /><span /><span /><span />
								</div>
							</div>
							<div className="auth-mock__panel">
								<strong>Publishing · AI Studio</strong>
								<div className="auth-mock__queue">
									<em>WordPress · queued</em>
									<em>Pinterest · scheduled</em>
									<em>Facebook · connected</em>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className="auth-channels" aria-label="Connected destinations">
					{R0_CHANNELS.live.map((channel) => (
						<span key={channel.id} className="auth-channels__chip auth-channels__chip--live">
							{channel.label}
						</span>
					))}
					<span className="auth-channels__chip auth-channels__chip--soon">More channels soon</span>
				</div>

				<div className="auth-onboard">
					<p className="auth-onboard__title">Get started</p>
					<div className="auth-onboard__steps">
						{R0_ONBOARDING.map((step, index) => (
							<span key={step.title} className="auth-onboard__step">
								<span aria-hidden="true">{index + 1}</span>
								{step.title}
							</span>
						))}
					</div>
				</div>

				<footer className="auth-footer">
					<nav className="auth-footer__links" aria-label="Legal and support">
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
					</nav>
					<span className="auth-footer__note">{R0_FOOTER.note}</span>
				</footer>
			</aside>

			<main id="main-content" className="auth-panel" tabIndex={-1}>
				<div className="auth-card">
					<div className="auth-card__mobile-brand">
						<PlatformBrandMark logoUrl={logoUrl} size={16} className="auth-brand__mark" />
						<span className="auth-brand__name">{platformName}</span>
					</div>
					<h1 className="auth-card__title">{title}</h1>
					{subtitle ? <p className="auth-card__subtitle">{subtitle}</p> : null}
					<div className="auth-card__body">{children}</div>
					{footer ? <div className="auth-card__footer">{footer}</div> : null}
					<div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
						<CheckCircle2 size={12} className="text-primary" aria-hidden="true" />
						Secure {platformName} workspace
					</div>
				</div>
			</main>
		</div>
	);
}
