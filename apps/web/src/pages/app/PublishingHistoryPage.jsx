import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Card, Empty, PageHeader, Select, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';

export default function PublishingHistoryPage() {
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [retryingId, setRetryingId] = useState('');
	const [cancellingId, setCancellingId] = useState('');
	const [statusFilter, setStatusFilter] = useState('');
	const [items, setItems] = useState([]);

	const load = async () => {
		setLoading(true);
		try {
			const query = new URLSearchParams({ page: '1', perPage: '100' });
			if (statusFilter) {
				query.set('status', statusFilter);
			}
			const response = await apiServerClient.fetch(`/pinterest/history?${query.toString()}`, { method: 'GET' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to load publishing history (${response.status})`);
			}
			setItems(Array.isArray(payload.items) ? payload.items : []);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
	}, [statusFilter]);

	const retryFailed = async (jobId) => {
		setRetryingId(jobId);
		try {
			const response = await apiServerClient.fetch(`/pinterest/jobs/${jobId}/retry`, { method: 'POST' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to retry job (${response.status})`);
			}
			toast({ title: 'Retry queued', description: 'Failed pin was moved back to publishing queue.' });
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Retry failed', description: error.message });
		} finally {
			setRetryingId('');
		}
	};

	const cancelScheduled = async (jobId) => {
		setCancellingId(jobId);
		try {
			const response = await apiServerClient.fetch(`/pinterest/jobs/${jobId}/cancel`, { method: 'POST' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to cancel schedule (${response.status})`);
			}
			toast({ title: 'Schedule cancelled', description: 'Scheduled pin was moved back to draft.' });
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Cancel failed', description: error.message });
		} finally {
			setCancellingId('');
		}
	};

	return (
		<div>
			<PageHeader
				title="Publishing History"
				subtitle="Track published, failed and scheduled pins. Retry failed jobs with one click."
				action={
					<div className="w-48">
						<Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
							<option value="">All statuses</option>
							<option value="published">Published</option>
							<option value="failed">Failed</option>
							<option value="scheduled">Scheduled</option>
						</Select>
					</div>
				}
			/>

			{loading ? (
				<div className="flex items-center justify-center py-10 text-muted-foreground"><Spinner className="mr-2 h-4 w-4" /> Loading history...</div>
			) : items.length === 0 ? (
				<Empty title="No publishing records yet" subtitle="Publish or schedule pins from AI Pins page to populate history." />
			) : (
				<div className="space-y-3">
					{items.map((item) => (
						<Card key={item.id}>
							<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
								<div className="min-w-0">
									<p className="truncate font-semibold">{item.pin?.title || 'Untitled pin'}</p>
									<p className="mt-1 text-xs text-muted-foreground">Board: {item.boardName || item.boardId}</p>
									<p className="text-xs text-muted-foreground">Scheduled: {item.scheduledAt ? new Date(item.scheduledAt).toLocaleString() : '—'}</p>
									{item.publishedAt ? <p className="text-xs text-muted-foreground">Published: {new Date(item.publishedAt).toLocaleString()}</p> : null}
									{item.lastError ? <p className="mt-1 text-xs text-red-600">Error: {item.lastError}</p> : null}
									{item.pinterestPinUrl ? <a className="text-xs text-primary underline" href={item.pinterestPinUrl} target="_blank" rel="noreferrer">Open Pinterest pin</a> : null}
								</div>
								<div className="flex items-center gap-2">
									<Badge tone={item.status === 'published' ? 'green' : item.status === 'failed' ? 'red' : 'amber'}>{item.status}</Badge>
									{item.status === 'failed' ? (
										<Button size="sm" variant="outline" disabled={retryingId === item.id} onClick={() => retryFailed(item.id)}>
											{retryingId === item.id ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw size={14} />} Retry Failed
										</Button>
									) : null}
									{item.status === 'scheduled' ? (
										<Button size="sm" variant="outline" disabled={cancellingId === item.id} onClick={() => cancelScheduled(item.id)}>
											{cancellingId === item.id ? <Spinner className="h-3.5 w-3.5" /> : null} Cancel
										</Button>
									) : null}
								</div>
							</div>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
