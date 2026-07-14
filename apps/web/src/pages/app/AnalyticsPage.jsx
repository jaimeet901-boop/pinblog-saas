import { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, AlertTriangle } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Card, Empty, PageHeader, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';

export default function AnalyticsPage() {
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [summary, setSummary] = useState({ published: 0, failed: 0, scheduled: 0 });
	const [items, setItems] = useState([]);

	useEffect(() => {
		(async () => {
			setLoading(true);
			try {
				const response = await apiServerClient.fetch('/pinterest/analytics', { method: 'GET' });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(payload?.message || `Failed to load analytics (${response.status})`);
				}
				setSummary(payload.summary || { published: 0, failed: 0, scheduled: 0 });
				setItems(Array.isArray(payload.items) ? payload.items : []);
			} catch (error) {
				toast({ variant: 'destructive', title: 'Error', description: error.message });
			} finally {
				setLoading(false);
			}
		})();
	}, []);

	const cards = [
		{ label: 'Published Pins', value: summary.published, icon: CheckCircle2, tone: 'text-emerald-600 dark:text-emerald-400' },
		{ label: 'Failed Pins', value: summary.failed, icon: AlertTriangle, tone: 'text-red-600 dark:text-red-400' },
		{ label: 'Scheduled Pins', value: summary.scheduled, icon: CalendarClock, tone: 'text-amber-600 dark:text-amber-400' },
	];

	return (
		<div>
			<PageHeader title="Pinterest Analytics" subtitle="Publishing outcomes and performance-ready fields for each published pin." />

			<div className="grid gap-4 sm:grid-cols-3">
				{cards.map(({ label, value, icon: Icon, tone }) => (
					<Card key={label}>
						<span className={`flex h-10 w-10 items-center justify-center rounded-xl bg-secondary ${tone}`}><Icon size={19} /></span>
						<p className="mt-4 text-3xl font-bold tabular-nums">{value ?? 0}</p>
						<p className="text-sm text-muted-foreground">{label}</p>
					</Card>
				))}
			</div>

			<Card className="mt-4">
				<h3 className="mb-3 font-semibold">Published Pins</h3>
				{loading ? (
					<div className="flex items-center justify-center py-8 text-muted-foreground"><Spinner className="mr-2 h-4 w-4" /> Loading analytics...</div>
				) : items.length === 0 ? (
					<Empty title="No published pins yet" subtitle="Once pins are published, analytics-ready rows will appear here." />
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[900px] border-collapse text-sm">
							<thead>
								<tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
									<th className="px-3 py-2">Pin</th>
									<th className="px-3 py-2">Publish Date</th>
									<th className="px-3 py-2">Board</th>
									<th className="px-3 py-2">Status</th>
									<th className="px-3 py-2">Pinterest Link</th>
									<th className="px-3 py-2">Impressions</th>
									<th className="px-3 py-2">Saves</th>
									<th className="px-3 py-2">Outbound Clicks</th>
									<th className="px-3 py-2">Closeups</th>
								</tr>
							</thead>
							<tbody>
								{items.map((item) => (
									<tr key={item.id} className="border-b border-border/70 align-top">
										<td className="px-3 py-2">
											<p className="max-w-xs truncate font-medium">{item.pin?.title || 'Untitled pin'}</p>
										</td>
										<td className="px-3 py-2 text-muted-foreground">{item.publishedAt ? new Date(item.publishedAt).toLocaleString() : '—'}</td>
										<td className="px-3 py-2 text-muted-foreground">{item.boardName || item.boardId || '—'}</td>
										<td className="px-3 py-2"><Badge tone={item.status === 'published' ? 'green' : 'default'}>{item.status}</Badge></td>
										<td className="px-3 py-2">{item.pinterestPinUrl ? <a className="text-primary underline" href={item.pinterestPinUrl} target="_blank" rel="noreferrer">Open</a> : '—'}</td>
										<td className="px-3 py-2 text-muted-foreground">{item.performance?.impressions ?? '—'}</td>
										<td className="px-3 py-2 text-muted-foreground">{item.performance?.saves ?? '—'}</td>
										<td className="px-3 py-2 text-muted-foreground">{item.performance?.outboundClicks ?? '—'}</td>
										<td className="px-3 py-2 text-muted-foreground">{item.performance?.closeups ?? '—'}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Card>
		</div>
	);
}
