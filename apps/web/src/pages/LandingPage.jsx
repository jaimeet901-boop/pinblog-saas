import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
	Sparkles, PenLine, Image as ImageIcon, Globe, CalendarDays, Pin, BarChart3, Check, ArrowRight,
	Shield, Zap, Search, Send, Palette, Share2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import './auth/AuthShell.css';

const FEATURES = [
	{ icon: PenLine, title: 'AI Writer', desc: 'Full recipe articles with titles, meta, FAQ and JSON-LD schema in one click.' },
	{ icon: ImageIcon, title: 'AI Image Generator', desc: 'Generate square, portrait and landscape pins that stop the scroll.' },
	{ icon: Pin, title: 'AI Pins Studio', desc: 'Design branded pins with templates and brand kits in minutes.' },
	{ icon: Send, title: 'Publishing Center', desc: 'Push drafts or scheduled posts to WordPress and Pinterest from one queue.' },
	{ icon: CalendarDays, title: 'Content Calendar', desc: 'A single monthly view for every scheduled article and pin.' },
	{ icon: BarChart3, title: 'Analytics Center', desc: 'Track articles, images, published and scheduled content over time.' },
	{ icon: Palette, title: 'Brand Kit', desc: 'Keep colors, fonts, and watermarks consistent across every generation.' },
	{ icon: Share2, title: 'Pinterest Hub', desc: 'Connect boards and grow traffic with multi-account publishing.' },
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

const PLANS = [
	{ name: 'Free', price: '$0', items: ['5 articles / mo', '1 website', '10 images'], cta: 'Start free' },
	{ name: 'Starter', price: '$19', items: ['50 articles / mo', '3 websites', '200 images'], cta: 'Choose Starter' },
	{ name: 'Pro', price: '$49', items: ['200 articles / mo', '10 websites', 'Pinterest scheduler'], highlight: true, cta: 'Choose Pro' },
	{ name: 'Agency', price: '$129', items: ['Unlimited articles', 'Unlimited websites', 'Team & API access'], cta: 'Choose Agency' },
];

const FOOTER_LINKS = [
	{ label: 'Privacy Policy', href: '#privacy' },
	{ label: 'Terms', href: '#terms' },
	{ label: 'Documentation', href: '#docs' },
	{ label: 'Support', href: '#support' },
	{ label: 'Contact', href: '#contact' },
];

export default function LandingPage() {
	const { isAuthed } = useAuth();
	const cta = isAuthed ? '/app' : '/signup';

	return (
		<div className="welcome-atelier text-foreground">
			<header className="welcome-nav">
				<div className="mx-auto flex max-w-[76rem] items-center justify-between px-5 py-4">
					<Link to="/" className="auth-brand">
						<span className="auth-brand__mark"><Sparkles size={18} /></span>
						<span className="auth-brand__name">Chef IA</span>
					</Link>
					<nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
						<a href="#features" className="hover:text-foreground">Features</a>
						<a href="#why" className="hover:text-foreground">Why Chef IA</a>
						<a href="#pricing" className="hover:text-foreground">Pricing</a>
					</nav>
					<div className="flex items-center gap-2">
						<Link to="/login" className="rounded-xl px-4 py-2 text-sm font-medium hover:bg-secondary">Log in</Link>
						<Link to={cta} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
							Get started
						</Link>
					</div>
				</div>
			</header>

			<section className="welcome-hero">
				<span className="auth-hero__glow auth-hero__glow--a" aria-hidden="true" />
				<span className="auth-hero__glow auth-hero__glow--b" aria-hidden="true" />
				<div className="welcome-hero__grid relative z-[1]">
					<motion.div
						initial={{ opacity: 0, y: 18 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.55, ease: 'easeOut' }}
					>
						<p className="auth-hero__eyebrow">Welcome to Chef IA</p>
						<h1 className="auth-hero__title">Create, Design & Publish Pinterest Content with AI</h1>
						<p className="auth-hero__desc">
							Chef IA writes SEO-ready posts, generates scroll-stopping pins, and publishes to WordPress and Pinterest — all in one warm Atelier workspace.
						</p>
						<div className="mt-7 flex flex-wrap gap-3">
							<Link to={cta} className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-medium text-primary-foreground hover:opacity-90">
								Create your first workspace <ArrowRight size={17} />
							</Link>
							<Link to="/login" className="inline-flex items-center gap-2 rounded-xl border border-border px-6 py-3 font-medium hover:bg-secondary">
								Sign in
							</Link>
						</div>
						<div className="auth-trust mt-7">
							{TRUST.map(({ icon: Icon, label }) => (
								<span key={label} className="auth-trust__pill"><Icon size={12} /> {label}</span>
							))}
						</div>
					</motion.div>

					<motion.div
						initial={{ opacity: 0, scale: 0.97 }}
						animate={{ opacity: 1, scale: 1 }}
						transition={{ duration: 0.65, ease: 'easeOut', delay: 0.12 }}
						className="auth-mock"
						aria-hidden="true"
					>
						<div className="auth-mock__stage min-h-[16rem]">
							<div className="auth-mock__blur" />
							<div className="auth-mock__panels" style={{ gridTemplateColumns: '1.1fr 1fr', minHeight: '12rem' }}>
								<div className="auth-mock__panel">
									<strong>Dashboard</strong>
									<div className="auth-mock__bars">
										<span className="auth-mock__bar" />
										<span className="auth-mock__bar" />
										<span className="auth-mock__bar" />
										<span className="auth-mock__bar" />
									</div>
								</div>
								<div className="auth-mock__panel">
									<strong>Analytics · Writer · Pins · Calendar</strong>
									<div className="auth-mock__dots">
										{Array.from({ length: 10 }).map((_, i) => (
											<span key={i} className="auth-mock__dot" />
										))}
									</div>
								</div>
							</div>
							<div className="auth-features mt-3" style={{ position: 'relative', zIndex: 1 }}>
								{FEATURES.slice(0, 4).map(({ icon: Icon, title }) => (
									<div key={title} className="auth-feature">
										<span className="auth-feature__icon"><Icon size={14} /></span>
										<p className="auth-feature__title">{title}</p>
									</div>
								))}
							</div>
						</div>
					</motion.div>
				</div>
			</section>

			<section id="features" className="welcome-panel">
				<h2 className="font-display text-3xl font-semibold tracking-tight">Everything in the Atelier</h2>
				<p className="mt-2 max-w-lg text-muted-foreground">From keyword to published pin — one premium workflow.</p>
				<div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{FEATURES.map(({ icon: Icon, title, desc }) => (
						<div key={title} className="welcome-card">
							<span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
								<Icon size={20} />
							</span>
							<h3 className="mt-4 text-lg font-semibold">{title}</h3>
							<p className="mt-1.5 text-sm text-muted-foreground">{desc}</p>
						</div>
					))}
				</div>
			</section>

			<section id="why" className="welcome-panel pt-0">
				<h2 className="font-display text-3xl font-semibold tracking-tight">Why Chef IA</h2>
				<p className="mt-2 text-muted-foreground">Three pillars of the generation-to-publish loop.</p>
				<div className="auth-why mt-8">
					{WHY.map((item) => (
						<div key={item.title} className="auth-why__card">
							<h3>{item.title}</h3>
							<p>{item.body}</p>
						</div>
					))}
				</div>
				<div className="auth-onboard mt-8">
					<p className="auth-onboard__title">Onboarding preview</p>
					<div className="auth-onboard__steps">
						{['Create Workspace', 'Add Website', 'Connect WordPress', 'Connect Pinterest', 'Ready to Start'].map((step, index) => (
							<span key={step} className="auth-onboard__step">
								<span>{index + 1}</span>
								{step}
							</span>
						))}
					</div>
					<p className="mt-2 text-[11px] text-muted-foreground">Guided setup preview — coming soon in your workspace.</p>
				</div>
			</section>

			<section id="pricing" className="welcome-panel pt-0">
				<h2 className="font-display text-3xl font-semibold tracking-tight">Simple, scalable pricing</h2>
				<p className="mt-2 text-muted-foreground">Start free. Upgrade as your traffic grows.</p>
				<div className="mt-8 grid gap-4 md:grid-cols-4">
					{PLANS.map((p) => (
						<div
							key={p.name}
							className={`welcome-card flex flex-col ${p.highlight ? 'border-primary ring-1 ring-primary/30' : ''}`}
						>
							{p.highlight ? <span className="mb-2 inline-block w-fit rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">Popular</span> : null}
							<h3 className="font-display text-lg font-semibold">{p.name}</h3>
							<p className="mt-2 text-3xl font-bold">{p.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
							<ul className="mt-5 flex-1 space-y-2 text-sm">
								{p.items.map((i) => (
									<li key={i} className="flex items-center gap-2"><Check size={15} className="text-primary" /> {i}</li>
								))}
							</ul>
							<Link to={cta} className={`mt-6 rounded-xl py-2.5 text-center text-sm font-medium ${p.highlight ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-secondary'}`}>
								{p.cta}
							</Link>
						</div>
					))}
				</div>
			</section>

			<footer className="border-t border-border/80">
				<div className="mx-auto flex max-w-[76rem] flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-2">
						<span className="auth-brand__mark !h-8 !w-8"><Sparkles size={14} /></span>
						<span className="font-display font-semibold text-foreground">Chef IA</span>
						<span className="text-xs">Version 0.0.0</span>
					</div>
					<div className="auth-footer__links">
						{FOOTER_LINKS.map((link) => (
							<a key={link.label} href={link.href}>{link.label}</a>
						))}
					</div>
				</div>
			</footer>
		</div>
	);
}
