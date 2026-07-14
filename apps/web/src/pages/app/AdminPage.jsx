import { useEffect, useState } from 'react';
import { Users, CreditCard, ShieldCheck } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import { Card, PageHeader, Badge, Spinner } from '@/components/kit';

const PLANS = ['free', 'starter', 'pro', 'agency'];
const PRICE = { free: 0, starter: 19, pro: 49, agency: 129 };

export default function AdminPage() {
	const [users, setUsers] = useState([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		(async () => {
			try { setUsers(await pb.collection('users').getFullList({ sort: '-created' })); }
			catch (_) { /* */ } finally { setLoading(false); }
		})();
	}, []);

	const dist = PLANS.map((p) => ({ plan: p, count: users.filter((u) => (u.plan || 'free') === p).length }));
	const mrr = users.reduce((s, u) => s + (PRICE[u.plan] || 0), 0);

	if (loading) return <div className="flex justify-center py-16"><Spinner className="text-primary" /></div>;

	return (
		<div>
			<PageHeader title="Admin Panel" subtitle="Manage users, plans and platform statistics." />
			<div className="grid gap-4 sm:grid-cols-3">
				<Card><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Users size={19} /></span><p className="mt-3 text-3xl font-bold">{users.length}</p><p className="text-sm text-muted-foreground">Total users</p></Card>
				<Card><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><CreditCard size={19} /></span><p className="mt-3 text-3xl font-bold">${mrr}</p><p className="text-sm text-muted-foreground">Estimated MRR</p></Card>
				<Card><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck size={19} /></span><p className="mt-3 text-3xl font-bold">{users.filter((u) => u.verified).length}</p><p className="text-sm text-muted-foreground">Verified accounts</p></Card>
			</div>

			<div className="mt-4 grid gap-4 lg:grid-cols-3">
				<Card>
					<h3 className="mb-3 font-semibold">Plan distribution</h3>
					<div className="space-y-3">
						{dist.map((d) => (
							<div key={d.plan}>
								<div className="mb-1 flex justify-between text-sm"><span className="capitalize">{d.plan}</span><span className="text-muted-foreground">{d.count}</span></div>
								<div className="h-2 w-full overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${users.length ? (d.count / users.length) * 100 : 0}%` }} /></div>
							</div>
						))}
					</div>
				</Card>
				<Card className="lg:col-span-2">
					<h3 className="mb-3 font-semibold">Users</h3>
					<div className="max-h-96 overflow-auto">
						<table className="w-full text-sm">
							<thead className="text-left text-xs uppercase text-muted-foreground">
								<tr className="border-b border-border"><th className="pb-2">Name</th><th className="pb-2">Email</th><th className="pb-2">Plan</th><th className="pb-2">Role</th></tr>
							</thead>
							<tbody className="divide-y divide-border">
								{users.map((u) => (
									<tr key={u.id}>
										<td className="py-2.5 font-medium">{u.name || '—'}</td>
										<td className="py-2.5 text-muted-foreground">{u.email}</td>
										<td className="py-2.5"><Badge tone="blue">{u.plan || 'free'}</Badge></td>
										<td className="py-2.5"><Badge tone={u.role === 'admin' ? 'amber' : 'default'}>{u.role || 'member'}</Badge></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Card>
			</div>
		</div>
	);
}
