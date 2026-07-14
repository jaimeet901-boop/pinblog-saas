import { useState } from 'react';
import { Check, Crown } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import { Card, PageHeader, Button, Badge } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

const PLANS = [
	{ id: 'free', name: 'Free', price: 0, items: ['5 articles / month', '1 website', '10 images', 'Community support'] },
	{ id: 'starter', name: 'Starter', price: 19, items: ['50 articles / month', '3 websites', '200 images', 'Email support'] },
	{ id: 'pro', name: 'Pro', price: 49, popular: true, items: ['200 articles / month', '10 websites', 'Pinterest scheduler', 'Priority support'] },
	{ id: 'agency', name: 'Agency', price: 129, items: ['Unlimited articles', 'Unlimited websites', 'Team & API access', 'Dedicated manager'] },
];

export default function SubscriptionPage() {
	const { user, refresh } = useAuth();
	const { toast } = useToast();
	const [busy, setBusy] = useState(null);

	const choose = async (plan) => {
		if (plan === user?.plan) return;
		setBusy(plan);
		// Stripe Checkout would be initiated here via a secure backend session.
		try {
			await pb.collection('users').update(pb.authStore.record.id, { plan });
			await refresh();
			toast({ title: 'Plan updated', description: `You are now on the ${plan} plan.` });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message });
		} finally { setBusy(null); }
	};

	return (
		<div>
			<PageHeader title="Subscription" subtitle="Choose the plan that fits your content volume." />
			<div className="mb-6 flex items-center gap-2 rounded-xl border border-border bg-secondary/50 p-4 text-sm">
				<Crown size={18} className="text-primary" />
				Current plan: <Badge tone="blue">{user?.plan || 'free'}</Badge>
				<span className="text-muted-foreground">· Secure billing powered by Stripe</span>
			</div>
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				{PLANS.map((p) => {
					const current = p.id === (user?.plan || 'free');
					return (
						<Card key={p.id} className={`flex flex-col ${p.popular ? 'ring-2 ring-primary' : ''}`}>
							{p.popular && <span className="mb-2 w-fit rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">Most popular</span>}
							<h3 className="font-display text-xl font-600">{p.name}</h3>
							<p className="mt-2 text-3xl font-bold">${p.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
							<ul className="mt-5 flex-1 space-y-2 text-sm">
								{p.items.map((i) => <li key={i} className="flex items-center gap-2"><Check size={15} className="text-primary" />{i}</li>)}
							</ul>
							<Button className="mt-6" variant={current ? 'outline' : p.popular ? 'primary' : 'outline'} disabled={current || busy === p.id} onClick={() => choose(p.id)}>
								{current ? 'Current plan' : busy === p.id ? 'Processing…' : `Upgrade to ${p.name}`}
							</Button>
						</Card>
					);
				})}
			</div>
		</div>
	);
}
