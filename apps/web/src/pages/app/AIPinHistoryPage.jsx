import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Card, Empty, PageHeader, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';

function formatDate(value) {
	if (!value) return '—';
	try {
		return new Date(value).toLocaleString();
	} catch {
		return '—';
	}
}

export default function AIPinHistoryPage() {
	const { toast } = useToast();
	const [items, setItems] = useState([]);
	const [loading, setLoading] = useState(true);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);

	const load = async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch(`/ai-pins/history?page=${page}&perPage=20`, { method: 'GET' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || 'Failed to load history');
			}
			setItems(payload.items || []);
			setTotalPages(payload.totalPages || 1);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
	}, [page]);

	return (
		<div>
			<PageHeader
				title="AI Pin History"
				subtitle="Every analysis, prompt, image, and edit is tracked here with credits used."
				action={<Link to="/app/ai-pins"><Button variant="outline">Back to AI Pins</Button></Link>}
			/>

			<Card>
				{loading ? (
					<div className="flex justify-center py-12"><Spinner /></div>
				) : items.length === 0 ? (
					<Empty icon={History} title="No generation history yet" subtitle="Analyze articles or generate pin images to build your history." />
				) : (
					<div className="space-y-3">
						{items.map((item) => (
							<div key={item.id} className="rounded-xl border border-border p-3">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="flex items-center gap-2">
										<Badge tone="blue">{item.eventType}</Badge>
										<span className="text-xs text-muted-foreground">{formatDate(item.created)}</span>
									</div>
									<div className="text-xs text-muted-foreground">
										AI: {item.aiCreditsUsed || 0} · Image: {item.imageCreditsUsed || 0}
									</div>
								</div>
								{item.prompt ? <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{item.prompt}</p> : null}
								{item.imageUrl ? <img src={item.imageUrl} alt="" className="mt-2 h-28 rounded-lg object-cover" loading="lazy" decoding="async" /> : null}
								{item.analysis?.title ? <p className="mt-2 text-sm font-medium">{item.analysis.title}</p> : null}
							</div>
						))}
						{totalPages > 1 ? (
							<div className="flex justify-between pt-2">
								<Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>Previous</Button>
								<p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
								<Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)}>Next</Button>
							</div>
						) : null}
					</div>
				)}
			</Card>
		</div>
	);
}
