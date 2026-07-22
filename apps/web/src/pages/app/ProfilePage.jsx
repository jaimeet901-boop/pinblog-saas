import { useEffect, useState } from 'react';
import { Mail, ShieldCheck, Save } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import apiServerClient from '@/lib/apiServerClient';
import { Card, PageHeader, Button, Input, Badge, Spinner } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

export default function ProfilePage() {
	const { user, refresh } = useAuth();
	const { toast } = useToast();
	const [name, setName] = useState(user?.name || '');
	const [profile, setProfile] = useState(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		(async () => {
			setLoading(true);
			try {
				const response = await apiServerClient.fetch('/workspace/v1/profile', { method: 'GET' });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok) throw new Error(payload.message || 'Failed to load profile');
				setProfile(payload);
				setName(payload.name || user?.name || '');
			} catch (err) {
				toast({ variant: 'destructive', title: 'Error', description: err?.message });
			} finally {
				setLoading(false);
			}
		})();
	}, [toast, user?.name]);

	const save = async (e) => {
		e.preventDefault();
		setSaving(true);
		try {
			const response = await apiServerClient.fetch('/workspace/v1/profile', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name }),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(payload.message || 'Could not update profile');
			setProfile(payload);
			await refresh();
			toast({ title: 'Profile updated' });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	const resendVerify = async () => {
		try {
			await pb.collection('users').requestVerification(user.email);
			toast({ title: 'Verification sent', description: 'Check your inbox.' });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message });
		}
	};

	const displayName = profile?.name || user?.name || 'Chef';
	const email = profile?.email || user?.email;
	const plan = profile?.planName || profile?.plan || user?.plan || 'free';
	const verified = profile?.verified ?? user?.verified;

	return (
		<div>
			<PageHeader title="Profile" subtitle="Manage your personal account details." />
			{loading ? (
				<div className="flex min-h-[30vh] items-center justify-center"><Spinner /></div>
			) : (
				<div className="grid max-w-3xl gap-4 lg:grid-cols-3">
					<Card className="flex flex-col items-center lg:col-span-1">
						<span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
							{(displayName || email || '?').slice(0, 1).toUpperCase()}
						</span>
						<p className="mt-3 font-semibold">{displayName}</p>
						<p className="text-sm text-muted-foreground">{email}</p>
						<div className="mt-3 flex gap-2">
							<Badge tone="blue">{plan}</Badge>
							<Badge tone={verified ? 'green' : 'amber'}>{verified ? 'verified' : 'unverified'}</Badge>
						</div>
						{profile?.workspaceName ? (
							<p className="mt-3 text-center text-xs text-muted-foreground">{profile.workspaceName} · {profile.role}</p>
						) : null}
					</Card>
					<Card className="lg:col-span-2">
						<form onSubmit={save} className="space-y-4">
							<Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
							<div>
								<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium"><Mail size={14} /> Email</span>
								<div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5 text-sm text-muted-foreground">{email}</div>
							</div>
							{!verified && (
								<div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
									<span className="flex items-center gap-2 text-amber-700 dark:text-amber-400"><ShieldCheck size={16} /> Email not verified</span>
									<Button type="button" size="sm" variant="outline" onClick={resendVerify}>Resend</Button>
								</div>
							)}
							<Button type="submit" disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save changes'}</Button>
						</form>
					</Card>
				</div>
			)}
		</div>
	);
}
