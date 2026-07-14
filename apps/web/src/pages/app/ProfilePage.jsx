import { useState } from 'react';
import { User, Mail, ShieldCheck, Save } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import { Card, PageHeader, Button, Input, Badge } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

export default function ProfilePage() {
	const { user, refresh } = useAuth();
	const { toast } = useToast();
	const [name, setName] = useState(user?.name || '');
	const [saving, setSaving] = useState(false);

	const save = async (e) => {
		e.preventDefault();
		setSaving(true);
		try {
			await pb.collection('users').update(user.id, { name });
			await refresh();
			toast({ title: 'Profile updated' });
		} catch (err) { toast({ variant: 'destructive', title: 'Error', description: err?.message }); }
		finally { setSaving(false); }
	};

	const resendVerify = async () => {
		try {
			await pb.collection('users').requestVerification(user.email);
			toast({ title: 'Verification sent', description: 'Check your inbox.' });
		} catch (err) { toast({ variant: 'destructive', title: 'Error', description: err?.message }); }
	};

	return (
		<div>
			<PageHeader title="Profile" subtitle="Manage your personal account details." />
			<div className="grid max-w-3xl gap-4 lg:grid-cols-3">
				<Card className="flex flex-col items-center lg:col-span-1">
					<span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
						{(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
					</span>
					<p className="mt-3 font-semibold">{user?.name || 'Chef'}</p>
					<p className="text-sm text-muted-foreground">{user?.email}</p>
					<div className="mt-3 flex gap-2">
						<Badge tone="blue">{user?.plan || 'free'}</Badge>
						<Badge tone={user?.verified ? 'green' : 'amber'}>{user?.verified ? 'verified' : 'unverified'}</Badge>
					</div>
				</Card>
				<Card className="lg:col-span-2">
					<form onSubmit={save} className="space-y-4">
						<Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
						<div>
							<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium"><Mail size={14} /> Email</span>
							<div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5 text-sm text-muted-foreground">{user?.email}</div>
						</div>
						{!user?.verified && (
							<div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
								<span className="flex items-center gap-2 text-amber-700 dark:text-amber-400"><ShieldCheck size={16} /> Email not verified</span>
								<Button type="button" size="sm" variant="outline" onClick={resendVerify}>Resend</Button>
							</div>
						)}
						<Button type="submit" disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save changes'}</Button>
					</form>
				</Card>
			</div>
		</div>
	);
}
