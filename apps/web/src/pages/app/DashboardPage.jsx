import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
	Globe, FileText, Image as ImageIcon, CalendarClock, Activity, Gauge, ArrowUpRight, PenLine, Sparkles, TrendingUp,
} from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import { Card, PageHeader, Badge, Button } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';

const PLAN_QUOTA = { free: 5, starter: 50, pro: 200, agency: 1000 };

const cardTheme = [
	{ icon: Globe, tint: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
	{ icon: FileText, tint: 'bg-primary/10 text-primary' },
	{ icon: ImageIcon, tint: 'bg-accent/15 text-accent-foreground' },
	{ icon: CalendarClock, tint: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
];

const container = {
	hidden: {},
	show: { transition: { staggerChildren: 0.06 } },
};
const item = {
	hidden: { opacity: 0, y: 12 },
	show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

export default function DashboardPage() {
	const { user } = useAuth();
	const [stats, setStats] = useState(null);
	const [recent, setRecent] = useState([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const owner = pb.authStore.record?.id;
		if (!owner) {
			setLoading(false);
			return;
		}
		(async () => {
			try {
				const [websites, articles, pins] = await Promise.all([
					pb.collection('websites').getFullList({ requestKey: 'd-w' }),
					pb.collection('articles').getFullList({ sort: '-created', requestKey: 'd-a' }),
					pb.collection('pins').getFullList({ requestKey: 'd-p' }),
				]);
				const now = new Date();
				const monthArticles = articles.filter((a) => new Date(a.created).getMonth() === now.getMonth());
				setStats({
					websites: websites.length,
					articles: articles.length,
					pins: pins.length,
					scheduled: [...articles, ...pins].filter((x) => x.status === 'scheduled').length,
					usage: monthArticles.length,
				});
				setRecent(articles.slice(0, 5));
			} catch (_) {
				setStats({ websites: 0, articles: 0, pins: 0, scheduled: 0, usage: 0 });
			} finally {
				setLoading(false);
			}
		})();
	}, []);

	const quota = PLAN_QUOTA[user?.plan || 'free'];
	const cards = [
		{ label: 'Connected websites', value: stats?.websites, icon: Globe, to: '/app/websites', tint: cardTheme[0].tint, delta: null },
		{ label: 'Articles generated', value: stats?.articles, icon: FileText, to: '/app/writer', tint: cardTheme[1].tint, delta: null },
		{ label: 'Pins created', value: stats?.pins, icon: ImageIcon, to: '/app/images', tint: cardTheme[2].tint, delta: null },
		{ label: 'Scheduled posts', value: stats?.scheduled, icon: CalendarClock, to: '/app/calendar', tint: cardTheme[3].tint, delta: null },
	];

	return (
		<div>
			<PageHeader
				title={`Hi, ${user?.name?.split(' ')[0] || 'Chef'} 👋`}
				subtitle="Here's what's cooking in your workspace."
				action={<Link to="/app/writer"><Button className="shadow-md shadow-primary/20"><PenLine size={16} /> New article</Button></Link>}
			/>

			<motion.div
				variants={container}
				initial="hidden"
				animate="show"
				className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
			>
				{cards.map(({ label, value, icon: Icon, to, tint }) => (
					<motion.div key={label} variants={item}>
						<Link to={to} className="block h-full">
							<Card className="group h-full cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/5">
								<div className="flex items-start justify-between">
									<span className={`flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110 ${tint}`}>
										<Icon size={20} />
									</span>
									<ArrowUpRight size={16} className="text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
								</div>
								{loading ? (
									<div className="mt-4 h-8 w-14 animate-pulse rounded-md bg-secondary" />
								) : (
									<p className="mt-4 text-3xl font-bold tabular-nums tracking-tight">{value ?? 0}</p>
								)}
								<p className="mt-1 text-sm text-muted-foreground">{label}</p>
							</Card>
						</Link>
					</motion.div>
				))}
			</motion.div>

			<div className="mt-4 grid gap-4 lg:grid-cols-3">
				<motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.15 }} className="lg:col-span-2">
					<Card className="h-full">
						<div className="mb-4 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
									<Activity size={16} />
								</span>
								<h3 className="font-semibold">Recent activity</h3>
							</div>
							<Link to="/app/writer" className="text-sm font-medium text-primary transition-colors hover:underline">Open writer</Link>
						</div>
						{loading ? (
							<div className="space-y-3">
								{[0, 1, 2].map((k) => (
									<div key={k} className="h-14 animate-pulse rounded-xl bg-secondary/60" />
								))}
							</div>
						) : recent.length === 0 ? (
							<div className="flex flex-col items-center py-10 text-center">
								<Sparkles className="mb-2 h-8 w-8 text-muted-foreground" />
								<p className="text-sm text-muted-foreground">No articles yet. Generate your first one!</p>
							</div>
						) : (
							<ul className="divide-y divide-border/70">
								{recent.map((a, i) => (
									<motion.li
										key={a.id}
										initial={{ opacity: 0, x: -8 }}
										animate={{ opacity: 1, x: 0 }}
										transition={{ duration: 0.3, delay: 0.05 * i }}
										className="flex items-center justify-between gap-3 py-3.5 transition-colors hover:bg-secondary/30 rounded-lg px-1 -mx-1"
									>
										<div className="flex min-w-0 items-center gap-3">
											<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
												<FileText size={15} />
											</span>
											<div className="min-w-0">
												<p className="truncate text-sm font-medium">{a.seo_title || a.keyword || 'Untitled'}</p>
												<p className="text-xs text-muted-foreground">{new Date(a.created).toLocaleDateString()}</p>
											</div>
										</div>
										<Badge tone={a.status === 'published' ? 'green' : a.status === 'scheduled' ? 'amber' : 'default'}>{a.status || 'draft'}</Badge>
									</motion.li>
								))}
							</ul>
						)}
					</Card>
				</motion.div>

				<motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.22 }} className="space-y-4">
					<Card>
						<div className="mb-3 flex items-center gap-2">
							<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<Gauge size={16} />
							</span>
							<h3 className="font-semibold">Monthly usage</h3>
						</div>
						<div className="flex items-baseline justify-between">
							<p className="text-sm text-muted-foreground">{stats?.usage ?? 0} / {quota} articles</p>
							<span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
								<TrendingUp size={12} /> on track
							</span>
						</div>
						<div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-secondary">
							<motion.div
								className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
								initial={{ width: 0 }}
								animate={{ width: `${Math.min(100, ((stats?.usage ?? 0) / quota) * 100)}%` }}
								transition={{ duration: 0.6, ease: 'easeOut', delay: 0.2 }}
							/>
						</div>
						<Link to="/app/subscription" className="mt-3 inline-block text-sm font-medium text-primary transition-colors hover:underline">Upgrade plan</Link>
					</Card>
					<Card>
						<div className="mb-3 flex items-center gap-2">
							<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<Sparkles size={16} />
							</span>
							<h3 className="font-semibold">API status</h3>
						</div>
						<ul className="space-y-2.5 text-sm">
							<li className="flex items-center justify-between"><span>AI engine</span><Badge tone="green">operational</Badge></li>
							<li className="flex items-center justify-between"><span>Image service</span><Badge tone="green">operational</Badge></li>
							<li className="flex items-center justify-between"><span>WordPress API</span><Badge tone="green">ready</Badge></li>
						</ul>
					</Card>
				</motion.div>
			</div>
		</div>
	);
}
