import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
	Sparkles, PenLine, Image as ImageIcon, Globe, CalendarDays, Pin, BarChart3, Check, ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const HERO = 'https://images.hostinger.com/4660b445-da4c-4dc0-909d-6989c99d6a67.png';
const DASH = 'https://images.hostinger.com/46300e6d-cd67-4301-a912-3e627554ce18.png';

const FEATURES = [
	{ icon: PenLine, title: 'SEO AI Writer', desc: 'Full recipe articles with titles, meta, FAQ and JSON-LD schema in one click.' },
	{ icon: ImageIcon, title: 'Pinterest Images', desc: 'Generate square, portrait and landscape pins that stop the scroll.' },
	{ icon: Globe, title: 'WordPress Publisher', desc: 'Push drafts or scheduled posts to unlimited WordPress sites via REST API.' },
	{ icon: Pin, title: 'Pinterest Scheduler', desc: 'Connect boards and auto-schedule pins to grow your traffic on autopilot.' },
	{ icon: CalendarDays, title: 'Content Calendar', desc: 'A single monthly view for every scheduled article and pin.' },
	{ icon: BarChart3, title: 'Analytics', desc: 'Track articles, images, published and scheduled content over time.' },
];

const PLANS = [
	{ name: 'Free', price: '$0', items: ['5 articles / mo', '1 website', '10 images'], cta: 'Start free' },
	{ name: 'Starter', price: '$19', items: ['50 articles / mo', '3 websites', '200 images'], cta: 'Choose Starter' },
	{ name: 'Pro', price: '$49', items: ['200 articles / mo', '10 websites', 'Pinterest scheduler'], highlight: true, cta: 'Choose Pro' },
	{ name: 'Agency', price: '$129', items: ['Unlimited articles', 'Unlimited websites', 'Team & API access'], cta: 'Choose Agency' },
];

export default function LandingPage() {
	const { isAuthed } = useAuth();
	const cta = isAuthed ? '/app' : '/signup';

	return (
		<div className="min-h-[100dvh] bg-background text-foreground">
			<header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
				<div className="mx-auto flex max-w-[76rem] items-center justify-between px-5 py-4">
					<div className="flex items-center gap-2">
						<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
							<Sparkles size={18} />
						</span>
						<span className="font-display text-xl font-600">Chef IA</span>
					</div>
					<nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
						<a href="#features" className="hover:text-foreground">Features</a>
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

			{/* Hero */}
			<section className="relative overflow-hidden">
				<div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/30 blur-3xl" />
				<div className="pointer-events-none absolute -left-20 top-40 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
				<div className="mx-auto grid max-w-[76rem] items-center gap-10 px-5 py-16 md:grid-cols-2 md:py-24">
					<motion.div
						initial={{ opacity: 0, y: 24 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.6, ease: 'easeOut' }}
					>
						<span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
							<Sparkles size={13} className="text-primary" /> AI content engine for food bloggers
						</span>
						<h1 className="mt-5 font-display text-4xl font-600 leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
							Cook up SEO articles &<br />
							<span className="text-primary">Pinterest pins</span> in minutes.
						</h1>
						<p className="mt-5 max-w-md text-lg text-muted-foreground">
							Chef IA writes recipe-ready, SEO-optimized blog posts, generates scroll-stopping pins, and publishes to WordPress and Pinterest automatically.
						</p>
						<div className="mt-8 flex flex-wrap gap-3">
							<Link to={cta} className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-medium text-primary-foreground hover:opacity-90">
								Start free <ArrowRight size={17} />
							</Link>
							<a href="#features" className="inline-flex items-center gap-2 rounded-xl border border-border px-6 py-3 font-medium hover:bg-secondary">
								See features
							</a>
						</div>
					</motion.div>
					<motion.div
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						transition={{ duration: 0.7, ease: 'easeOut', delay: 0.15 }}
						className="relative"
					>
						<img src={HERO} alt="Food blog dish flat-lay" className="animate-float-slow w-full rounded-3xl border border-border object-cover shadow-2xl" />
					</motion.div>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="mx-auto max-w-[76rem] px-5 py-16">
				<h2 className="font-display text-3xl font-600 tracking-tight">Everything a food blog needs</h2>
				<p className="mt-2 max-w-lg text-muted-foreground">From keyword to published post — one workflow, fully automated.</p>
				<div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{FEATURES.map(({ icon: Icon, title, desc }) => (
						<div key={title} className="rounded-2xl border border-border bg-card p-6 transition-transform hover:-translate-y-1">
							<span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
								<Icon size={20} />
							</span>
							<h3 className="mt-4 text-lg font-semibold">{title}</h3>
							<p className="mt-1.5 text-sm text-muted-foreground">{desc}</p>
						</div>
					))}
				</div>
			</section>

			{/* Showcase */}
			<section className="mx-auto max-w-[76rem] px-5 py-8">
				<div className="overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/10 to-accent/10 p-6 md:p-10">
					<img src={DASH} alt="Chef IA dashboard" className="w-full rounded-2xl border border-border shadow-xl" />
				</div>
			</section>

			{/* Pricing */}
			<section id="pricing" className="mx-auto max-w-[76rem] px-5 py-16">
				<h2 className="font-display text-3xl font-600 tracking-tight">Simple, scalable pricing</h2>
				<p className="mt-2 text-muted-foreground">Start free. Upgrade as your traffic grows.</p>
				<div className="mt-10 grid gap-4 md:grid-cols-4">
					{PLANS.map((p) => (
						<div
							key={p.name}
							className={`flex flex-col rounded-2xl border p-6 ${p.highlight ? 'border-primary bg-card shadow-lg ring-1 ring-primary/30' : 'border-border bg-card'}`}
						>
							{p.highlight && <span className="mb-2 inline-block w-fit rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">Popular</span>}
							<h3 className="font-display text-lg font-600">{p.name}</h3>
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

			<footer className="border-t border-border">
				<div className="mx-auto flex max-w-[76rem] flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-muted-foreground sm:flex-row">
					<div className="flex items-center gap-2">
						<Sparkles size={16} className="text-primary" />
						<span className="font-display font-600 text-foreground">Chef IA</span>
					</div>
					<p>© {new Date().getFullYear()} Chef IA. Built for recipe creators.</p>
				</div>
			</footer>
		</div>
	);
}
