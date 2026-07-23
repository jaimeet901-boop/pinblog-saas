import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminHero, StatusPill, AdminEmptyState } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

export default function AdminNotificationsPage() {
	const { toast } = useToast();
	const [notes, setNotes] = useState([]);
	const [loading, setLoading] = useState(true);
	const [composing, setComposing] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/notifications/templates');
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setNotes(Array.isArray(payload.items) ? payload.items : []);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Notifications failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [toast]);

	useEffect(() => {
		load();
	}, [load]);

	const compose = async () => {
		const title = window.prompt('Notification title');
		if (!title) return;
		setComposing(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/notifications/templates', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title, channel: 'email', status: 'draft' }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Template created' });
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Compose failed', description: error.message });
		} finally {
			setComposing(false);
		}
	};

	return (
		<div>
			<AdminHero
				title="Notifications"
				description="Platform announcement and alert templates from PocketBase."
				action={(
					<button type="button" className="admin-btn admin-btn--primary" onClick={compose} disabled={composing}>
						{composing ? <Loader2 size={13} className="animate-spin" /> : null} Compose
					</button>
				)}
			/>
			<section className="admin-card">
				{loading ? (
					<p className="admin-note flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading notifications…</p>
				) : null}
				{!loading && notes.length === 0 ? (
					<AdminEmptyState title="No templates yet" description="Compose a template or wait for workspace notifications." />
				) : (
					<div className="admin-list">
						{notes.map((note) => (
							<div key={note.id} className="admin-list__item">
								<span>
									<strong className="block">{note.title}</strong>
									<span style={{ color: 'var(--admin-muted)', fontSize: '0.75rem' }}>{note.channel}</span>
								</span>
								<StatusPill status={note.status} />
							</div>
						))}
					</div>
				)}
				<p className="admin-note">Templates are stored in PocketBase. Broadcasts stay manual.</p>
			</section>
		</div>
	);
}
