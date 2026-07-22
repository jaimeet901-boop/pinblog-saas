import { Link } from 'react-router-dom';
import {
	Sparkles, PenLine, Image as ImageIcon, Pin, Send, CalendarDays, BarChart3,
	Palette, Share2, Shield, Zap, Globe, Search, CheckCircle2,
} from 'lucide-react';
import './AuthShell.css';

const FEATURE_CARDS = [
	{ icon: PenLine, title: 'AI Writer' },
	{ icon: ImageIcon, title: 'AI Image Generator' },
	{ icon: Pin, title: 'AI Pins Studio' },
	{ icon: Send, title: 'Publishing Center' },
	{ icon: CalendarDays, title: 'Content Calendar' },
	{ icon: BarChart3, title: 'Analytics Center' },
	{ icon: Palette, title: 'Brand Kit' },
	{ icon: Share2, title: 'Pinterest Hub' },
];

const TRUST = [
	{ icon: Sparkles, label: 'AI Powered' },
	{ icon: Shield, label: 'Secure Workspace' },
	{ icon: Zap, label: 'Fast Publishing' },
	{ icon: Globe, label: 'Multi Website Support' },
	{ icon: Pin, label: 'Pinterest Ready' },
	{ icon: Search, label: 'SEO Optimized' },
];

const WHY = [
	{ title: 'AI Writing', body: 'Generate SEO articles in minutes.' },
	{ title: 'AI Design', body: 'Generate Pinterest images automatically.' },
	{ title: 'AI Publishing', body: 'Publish content to Pinterest and WordPress.' },
];

const ONBOARD_STEPS = [
	'Create Workspace',
	'Add Website',
	'Connect WordPress',
	'Connect Pinterest',
	'Ready to Start',
];

const FOOTER_LINKS = [
	{ label: 'Privacy Policy', href: '#privacy' },
	{ label: 'Terms', href: '#terms' },
	{ label: 'Documentation', href: '#docs' },
	{ label: 'Support', href: '#support' },
	{ label: 'Contact', href: '#contact' },
];

export default function AuthShell({ title, subtitle, children, footer }) {
	return (
		<div className="auth-atelier">
			<aside className="auth-hero" aria-label="Chef IA product story">
				<span className="auth-hero__glow auth-hero__glow--a" aria-hidden="true" />
				<span className="auth-hero__glow auth-hero__glow--b" aria-hidden="true" />
				<span className="auth-hero__glow auth-hero__glow--c" aria-hidden="true" />

				<Link to="/" className="auth-brand">
					<span className="auth-brand__mark"><Sparkles size={18} /></span>
					<span className="auth-brand__name">Chef IA</span>
				</Link>

				<div className="auth-hero__copy">
					<p className="auth-hero__eyebrow">Chef IA Atelier</p>
					<h2 className="auth-hero__title">Create, Design & Publish Pinterest Content with AI</h2>
					<p className="auth-hero__desc">
						One warm workspace for SEO writing, pin design, brand kits, and multi-site publishing — built for creators who ship every day.
					</p>
				</div>

				<div className="auth-features">
					{FEATURE_CARDS.map(({ icon: Icon, title: featureTitle }) => (
						<div key={featureTitle} className="auth-feature">
							<span className="auth-feature__icon"><Icon size={14} /></span>
							<p className="auth-feature__title">{featureTitle}</p>
						</div>
					))}
				</div>

				<div className="auth-mock" aria-hidden="true">
					<div className="auth-mock__stage">
						<div className="auth-mock__blur" />
						<div className="auth-mock__panels">
							<div className="auth-mock__panel">
								<strong>Dashboard</strong>
								<div className="auth-mock__bars">
									<span className="auth-mock__bar" />
									<span className="auth-mock__bar" />
									<span className="auth-mock__bar" />
								</div>
							</div>
							<div className="auth-mock__panel">
								<strong>Analytics</strong>
								<div className="auth-mock__bars">
									<span className="auth-mock__bar" />
									<span className="auth-mock__bar" />
								</div>
							</div>
							<div className="auth-mock__panel">
								<strong>AI Writer · Pins · Calendar</strong>
								<div className="auth-mock__dots">
									<span className="auth-mock__dot" />
									<span className="auth-mock__dot" />
									<span className="auth-mock__dot" />
									<span className="auth-mock__dot" />
									<span className="auth-mock__dot" />
									<span className="auth-mock__dot" />
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className="auth-trust">
					{TRUST.map(({ icon: Icon, label }) => (
						<span key={label} className="auth-trust__pill">
							<Icon size={12} /> {label}
						</span>
					))}
				</div>

				<div className="auth-why">
					{WHY.map((item) => (
						<div key={item.title} className="auth-why__card">
							<h3>{item.title}</h3>
							<p>{item.body}</p>
						</div>
					))}
				</div>

				<div className="auth-onboard">
					<p className="auth-onboard__title">Onboarding preview</p>
					<div className="auth-onboard__steps">
						{ONBOARD_STEPS.map((step, index) => (
							<span key={step} className="auth-onboard__step">
								<span>{index + 1}</span>
								{step}
							</span>
						))}
					</div>
					<p className="mt-2 text-[11px] text-muted-foreground">
						Guided setup preview — coming soon in your workspace.
					</p>
				</div>

				<footer className="auth-footer">
					<div className="auth-footer__links">
						{FOOTER_LINKS.map((link) => (
							<a key={link.label} href={link.href}>{link.label}</a>
						))}
					</div>
					<span>Version 0.0.0</span>
				</footer>
			</aside>

			<section className="auth-panel">
				<div className="auth-card">
					<div className="auth-card__mobile-brand">
						<span className="auth-brand__mark"><Sparkles size={16} /></span>
						<span className="auth-brand__name">Chef IA</span>
					</div>
					<h1 className="auth-card__title">{title}</h1>
					{subtitle ? <p className="auth-card__subtitle">{subtitle}</p> : null}
					<div className="auth-card__body">{children}</div>
					{footer ? <div className="auth-card__footer">{footer}</div> : null}
					<div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
						<CheckCircle2 size={12} className="text-primary" /> Secure Chef IA workspace
					</div>
				</div>
			</section>
		</div>
	);
}
