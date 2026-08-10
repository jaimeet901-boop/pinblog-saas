import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
	PenLine,
	Palette,
	Pin,
	Facebook,
	Globe,
	Send,
	CalendarDays,
	BarChart3,
	Building2,
	Layers,
	ArrowRight,
	ArrowDown,
	Sparkles,
	CheckCircle2,
} from 'lucide-react';
import PlatformBrandMark from '@/components/PlatformBrandMark';
import PublicSeoHead from '@/components/PublicSeoHead';
import { useAuth } from '@/context/AuthContext';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';
import { buildPublicFooterLinks } from '@/lib/platformIdentity';
import { buildPageSeoOverrides } from '@/lib/platformSeo';
import {
	R0_HERO,
	R0_INTRO,
	R0_FEATURE_GROUPS,
	R0_ONBOARDING,
	R0_BENEFITS,
	R0_FOOTER,
	R0_PAGE_SEO,
	R0_WORKFLOW,
	R0_CHANNELS,
	R0_POSITION,
} from '@/lib/marketing/r0Copy';
import './auth/AuthShell.css';

const ICON = { size: 18, strokeWidth: 1.75 };
const ICON_SM = { size: 14, strokeWidth: 1.75 };

const FEATURE_ICONS = {
	'ai-writer': PenLine,
	'brand-kit': Palette,
	'pinterest-hub': Pin,
	'facebook-hub': Facebook,
	wordpress: Globe,
	'publishing-center': Send,
	'unified-calendar': CalendarDays,
	analytics: BarChart3,
	workspaces: Building2,
	'multi-website': Layers,
};

const CHANNEL_ICONS = {
	wordpress: Globe,
	pinterest: Pin,
	facebook: Facebook,
};

const CAL_BUSY = new Set([2, 5, 8, 11, 13]);

function ProductPreview() {
	return (
		<div className="lp-preview" aria-hidden="true">
			<div className="lp-preview__chrome">
				<span />
				<span />
				<span />
				<em>Chef IA workspace</em>
				<div className="lp-preview__tabs">
					<span className="is-active">Overview</span>
					<span>Calendar</span>
					<span>Publish</span>
				</div>
			</div>
			<div className="lp-preview__body">
				<aside className="lp-preview__rail">
					<span className="lp-preview__rail-item is-active"><CalendarDays {...ICON_SM} /></span>
					<span className="lp-preview__rail-item"><PenLine {...ICON_SM} /></span>
					<span className="lp-preview__rail-item"><Send {...ICON_SM} /></span>
					<span className="lp-preview__rail-item"><BarChart3 {...ICON_SM} /></span>
					<span className="lp-preview__rail-item"><Pin {...ICON_SM} /></span>
					<span className="lp-preview__rail-item"><Facebook {...ICON_SM} /></span>
				</aside>
				<div className="lp-preview__grid">
					<div className="lp-preview__panel lp-preview__panel--wide">
						<header className="lp-preview__panel-head">
							<strong>Unified Calendar</strong>
							<em>This week</em>
						</header>
						<div className="lp-preview__cal">
							{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
								<span key={`h-${i}`} className="lp-preview__cal-label">{d}</span>
							))}
							{Array.from({ length: 14 }).map((_, i) => (
								<span
									key={i}
									className={CAL_BUSY.has(i) ? 'is-busy' : undefined}
								>
									{CAL_BUSY.has(i) ? <i /> : null}
								</span>
							))}
						</div>
					</div>
					<div className="lp-preview__panel">
						<header className="lp-preview__panel-head">
							<strong>AI Writer</strong>
							<em>Draft</em>
						</header>
						<div className="lp-preview__writer">
							<span className="lp-preview__writer-title" />
							<span style={{ width: '92%' }} />
							<span style={{ width: '78%' }} />
							<span style={{ width: '86%' }} />
							<span style={{ width: '64%' }} />
						</div>
					</div>
					<div className="lp-preview__panel">
						<header className="lp-preview__panel-head">
							<strong>Publishing Center</strong>
							<em>Queue</em>
						</header>
						<ul className="lp-preview__queue">
							<li><span className="lp-preview__dot lp-preview__dot--wp" /><b>WordPress</b><em>queued</em></li>
							<li><span className="lp-preview__dot lp-preview__dot--pin" /><b>Pinterest</b><em>scheduled</em></li>
							<li><span className="lp-preview__dot lp-preview__dot--fb" /><b>Facebook</b><em>connected</em></li>
						</ul>
					</div>
					<div className="lp-preview__panel">
						<header className="lp-preview__panel-head">
							<strong>Analytics</strong>
							<em>+18%</em>
						</header>
						<div className="lp-preview__spark">
							<span /><span /><span /><span /><span /><span /><span /><span />
						</div>
						<div className="lp-preview__hubs">
							<span><Pin {...ICON_SM} /> Pinterest Hub</span>
							<span><Facebook {...ICON_SM} /> Facebook Hub</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default function LandingPage() {
	const { isAuthed } = useAuth();
	const identity = usePlatformIdentity();
	const {
		platformName,
		supportEmail,
		contactEmail,
		documentationUrl,
		loginLogoUrl,
		platformLogoUrl,
	} = identity;
	const brandLogoUrl = loginLogoUrl || platformLogoUrl;
	const primaryHref = isAuthed ? '/app' : '/signup';
	const reduceMotion = useReducedMotion();
	const seoOverrides = useMemo(
		() => buildPageSeoOverrides(R0_PAGE_SEO.landing, identity),
		[identity],
	);
	const footerLinks = buildPublicFooterLinks({
		supportEmail,
		contactEmail,
		documentationUrl,
	});
	const heroMotion = reduceMotion
		? { initial: false, animate: false }
		: { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, ease: 'easeOut' } };
	const previewMotion = reduceMotion
		? { initial: false, animate: false }
		: { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.55, ease: 'easeOut', delay: 0.08 } };

	return (
		<div className="welcome-atelier text-foreground">
			<PublicSeoHead overrides={seoOverrides} />
			<a href="#main-content" className="skip-link">Skip to main content</a>

			<header className="welcome-nav">
				<div className="lp-nav">
					<Link to="/" className="auth-brand">
						<PlatformBrandMark logoUrl={brandLogoUrl} size={18} className="auth-brand__mark" />
						<span className="auth-brand__name">{platformName}</span>
					</Link>
					<nav className="lp-nav__links" aria-label="Primary">
						<a href="#product">Product</a>
						<a href="#features">Features</a>
						<a href="#workflow">Workflow</a>
						<a href="#channels">Channels</a>
						{documentationUrl ? (
							<a href={documentationUrl} target="_blank" rel="noopener noreferrer">Docs</a>
						) : null}
					</nav>
					<div className="lp-nav__actions">
						<Link to="/login" className="lp-btn lp-btn--ghost">Log in</Link>
						<Link to={primaryHref} className="lp-btn lp-btn--primary">
							{isAuthed ? 'Open workspace' : 'Get started'}
						</Link>
					</div>
				</div>
			</header>

			<main id="main-content" tabIndex={-1}>
			<section className="lp-hero">
				<span className="lp-hero__glow lp-hero__glow--a" aria-hidden="true" />
				<span className="lp-hero__glow lp-hero__glow--b" aria-hidden="true" />
				<div className="lp-hero__grid">
					<motion.div
						{...heroMotion}
						className="lp-hero__copy"
					>
						<p className="lp-kicker">{platformName}</p>
						<p className="lp-eyebrow">{R0_POSITION}</p>
						<h1 className="lp-hero__title">{R0_HERO.headline}</h1>
						<p className="lp-hero__desc">{R0_HERO.subheadline}</p>
						<div className="lp-hero__ctas">
							<Link to={primaryHref} className="lp-btn lp-btn--primary lp-btn--lg">
								{R0_HERO.primaryCta} <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
							</Link>
							<Link to="/login" className="lp-btn lp-btn--secondary lp-btn--lg">
								{R0_HERO.secondaryCta}
							</Link>
						</div>
					</motion.div>
					<motion.div {...previewMotion}>
						<ProductPreview />
					</motion.div>
				</div>
			</section>

			<section id="product" className="lp-section">
				<div className="lp-section__inner lp-intro">
					<h2 className="lp-section__title">One workspace for the full content pipeline</h2>
					<p className="lp-section__lead">{R0_INTRO}</p>
				</div>
			</section>

			<section id="features" className="lp-section lp-section--muted">
				<div className="lp-section__inner">
					<div className="lp-section__head">
						<h2 className="lp-section__title">Built from modules you already use</h2>
						<p className="lp-section__lead">
							Grouped around create, brand, connect, schedule, and measure — not a single network.
						</p>
					</div>
					<div className="lp-feature-groups">
						{R0_FEATURE_GROUPS.map((group) => (
							<div key={group.id} className="lp-feature-group">
								<h3 className="lp-feature-group__title">{group.title}</h3>
								<div className="lp-feature-grid">
									{group.items.map((item) => {
										const Icon = FEATURE_ICONS[item.id] || Sparkles;
										return (
											<article key={item.id} className="lp-card">
												<span className="lp-card__icon" aria-hidden="true">
													<Icon {...ICON} />
												</span>
												<h4>{item.title}</h4>
												<p>{item.desc}</p>
											</article>
										);
									})}
								</div>
							</div>
						))}
					</div>
				</div>
			</section>

			<section id="workflow" className="lp-section">
				<div className="lp-section__inner">
					<div className="lp-section__head">
						<h2 className="lp-section__title">The workflow that stays when channels grow</h2>
						<p className="lp-section__lead">
							Create → Brand → Connect → Schedule → Measure
						</p>
					</div>
					<ol className="lp-workflow">
						{R0_WORKFLOW.map((step, index) => (
							<li key={step} className="lp-workflow__step">
								<span className="lp-workflow__index">{String(index + 1).padStart(2, '0')}</span>
								<strong>{step}</strong>
								{index < R0_WORKFLOW.length - 1 ? (
									<span className="lp-workflow__arrow" aria-hidden="true">
										<ArrowDown size={16} strokeWidth={1.75} className="lp-workflow__arrow-mobile" />
										<ArrowRight size={16} strokeWidth={1.75} className="lp-workflow__arrow-desktop" />
									</span>
								) : null}
							</li>
						))}
					</ol>
				</div>
			</section>

			<section id="channels" className="lp-section lp-section--muted">
				<div className="lp-section__inner">
					<div className="lp-section__head">
						<h2 className="lp-section__title">Connected destinations</h2>
						<p className="lp-section__lead">
							Live channels today. Future destinations fit the same strip without a redesign.
						</p>
					</div>
					<div className="lp-channels">
						{R0_CHANNELS.live.map((channel) => {
							const Icon = CHANNEL_ICONS[channel.id] || Globe;
							return (
								<div key={channel.id} className="lp-channel lp-channel--live">
									<span className="lp-channel__icon" aria-hidden="true"><Icon {...ICON} /></span>
									<span className="lp-channel__label">{channel.label}</span>
									<span className="lp-channel__status">Live</span>
								</div>
							);
						})}
						{R0_CHANNELS.soon.map((channel) => (
							<div key={channel.id} className="lp-channel lp-channel--soon" aria-label={`${channel.label} coming soon`}>
								<span className="lp-channel__icon lp-channel__icon--soon" aria-hidden="true" />
								<span className="lp-channel__label">{channel.label}</span>
								<span className="lp-channel__status">Soon</span>
							</div>
						))}
					</div>
				</div>
			</section>

			<section id="preview" className="lp-section">
				<div className="lp-section__inner">
					<div className="lp-section__head">
						<h2 className="lp-section__title">See the platform at a glance</h2>
						<p className="lp-section__lead">
							Unified Calendar, Analytics, Publishing Center, and AI Studio in one composition.
						</p>
					</div>
					<ProductPreview />
				</div>
			</section>

			<section id="benefits" className="lp-section lp-section--muted">
				<div className="lp-section__inner">
					<div className="lp-section__head">
						<h2 className="lp-section__title">Why teams choose {platformName}</h2>
					</div>
					<div className="lp-benefits">
						{R0_BENEFITS.map((item) => (
							<article key={item.title} className="lp-card lp-card--benefit">
								<h3>{item.title}</h3>
								<p>{item.desc}</p>
							</article>
						))}
					</div>
				</div>
			</section>

			<section id="onboarding" className="lp-section">
				<div className="lp-section__inner">
					<div className="lp-section__head">
						<h2 className="lp-section__title">Get started in five steps</h2>
						<p className="lp-section__lead">
							From workspace setup to schedule and publish across connected channels.
						</p>
					</div>
					<ol className="lp-onboard">
						{R0_ONBOARDING.map((step, index) => (
							<li key={step.title} className="lp-onboard__item">
								<span className="lp-onboard__num">{index + 1}</span>
								<div>
									<strong>{step.title}</strong>
									<p>{step.desc}</p>
								</div>
								{index < R0_ONBOARDING.length - 1 ? (
									<span className="lp-onboard__connector" aria-hidden="true" />
								) : null}
							</li>
						))}
					</ol>
					<div className="lp-onboard__cta">
						<Link to={primaryHref} className="lp-btn lp-btn--primary lp-btn--lg">
							{R0_HERO.primaryCta} <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
						</Link>
					</div>
				</div>
			</section>
			</main>

			<footer className="lp-footer">
				<div className="lp-footer__inner">
					<div className="lp-footer__brand">
						<PlatformBrandMark logoUrl={brandLogoUrl} size={14} className="auth-brand__mark !h-9 !w-9" />
						<div>
							<p className="lp-footer__name">{platformName}</p>
							<p className="lp-footer__tagline">{R0_FOOTER.tagline}</p>
							<p className="lp-footer__note">{R0_FOOTER.note}</p>
						</div>
					</div>
					<nav className="lp-footer__links" aria-label="Footer">
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
					<p className="lp-footer__secure">
						<CheckCircle2 size={14} aria-hidden="true" /> Secure {platformName} workspace
					</p>
				</div>
			</footer>
		</div>
	);
}
