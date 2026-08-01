import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound, Shield } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { PageHeader, Button, Input, Spinner, Card } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { getPasswordIssues } from '@/lib/auth';
import { markPasswordKnown, isPasswordKnownLocally } from '@/lib/passwordKnown';

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

export default function AccountPasswordPage() {
	const { user, externalAuths } = useAuth();
	const { toast } = useToast();
	const [searchParams] = useSearchParams();
	const [status, setStatus] = useState(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [form, setForm] = useState({
		oldPassword: '',
		password: '',
		passwordConfirm: '',
	});

	const googleLinked = useMemo(
		() => (externalAuths || []).some((item) => String(item?.provider || '').toLowerCase() === 'google')
			|| Boolean(status?.googleLinked),
		[externalAuths, status?.googleLinked],
	);

	const modeParam = searchParams.get('mode');
	const preferSetMode = modeParam === 'set'
		|| (modeParam !== 'change' && googleLinked && !isPasswordKnownLocally(user?.id));
	const canSetWithoutOld = Boolean(status?.canSetWithoutOldPassword);
	const requireOldPassword = !preferSetMode || !canSetWithoutOld;

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			try {
				const response = await apiServerClient.fetch('/workspace/v1/account/password');
				if (!response.ok) throw new Error(await readApiError(response));
				const payload = await response.json();
				if (!cancelled) setStatus(payload);
			} catch (error) {
				if (!cancelled) {
					toast({ variant: 'destructive', title: 'Could not load password status', description: error.message });
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, [toast]);

	const submit = async (event) => {
		event.preventDefault();
		const issues = getPasswordIssues(form.password);
		if (issues.length) {
			toast({ variant: 'destructive', title: 'Password too weak', description: issues[0] });
			return;
		}
		if (form.password !== form.passwordConfirm) {
			toast({ variant: 'destructive', title: 'Passwords do not match', description: 'Confirm the new password carefully.' });
			return;
		}
		if (requireOldPassword && !form.oldPassword) {
			toast({ variant: 'destructive', title: 'Current password required', description: 'Enter your current password to change it.' });
			return;
		}

		setSaving(true);
		try {
			const body = {
				password: form.password,
				passwordConfirm: form.passwordConfirm,
			};
			if (requireOldPassword || form.oldPassword) {
				body.oldPassword = form.oldPassword;
			}
			const response = await apiServerClient.fetch('/workspace/v1/account/password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			markPasswordKnown(user?.id);
			setForm({ oldPassword: '', password: '', passwordConfirm: '' });
			toast({ title: payload.mode === 'set' ? 'Password set' : 'Password updated', description: payload.message });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Password update failed', description: error.message });
		} finally {
			setSaving(false);
		}
	};

	const title = requireOldPassword ? 'Change password' : 'Set password';
	const subtitle = requireOldPassword
		? 'Update the password used for email sign-in. You’ll need your current password.'
		: 'Create a password so you can also sign in with email. Confirm it twice.';

	return (
		<div>
			<PageHeader
				title={title}
				subtitle={subtitle}
				action={<Link to="/app/settings?tab=security"><Button variant="outline" size="sm">Back to Security</Button></Link>}
			/>

			{loading ? (
				<div className="flex min-h-[30vh] items-center justify-center"><Spinner /></div>
			) : (
				<div className="mx-auto grid max-w-xl gap-4">
					{googleLinked && !requireOldPassword ? (
						<Card className="border-amber-500/30 bg-amber-500/10">
							<p className="text-sm text-amber-900 dark:text-amber-200">
								You are currently signed in using Google. You can set a password to allow future email/password login.
							</p>
						</Card>
					) : null}

					<Card>
						<form className="space-y-4" onSubmit={submit}>
							{requireOldPassword ? (
								<Input
									label="Current password"
									type="password"
									autoComplete="current-password"
									value={form.oldPassword}
									onChange={(e) => setForm((prev) => ({ ...prev, oldPassword: e.target.value }))}
									required
								/>
							) : null}
							<Input
								label="New password"
								type="password"
								autoComplete="new-password"
								value={form.password}
								onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
								required
							/>
							<Input
								label="Confirm new password"
								type="password"
								autoComplete="new-password"
								value={form.passwordConfirm}
								onChange={(e) => setForm((prev) => ({ ...prev, passwordConfirm: e.target.value }))}
								required
							/>
							<p className="text-xs text-muted-foreground">
								Use at least 10 characters with upper and lowercase letters, a number, and a symbol.
							</p>
							<div className="flex flex-wrap gap-2">
								<Button type="submit" disabled={saving}>
									{saving ? <Spinner className="h-4 w-4" /> : (requireOldPassword ? <Shield size={14} /> : <KeyRound size={14} />)}
									{requireOldPassword ? 'Update password' : 'Set password'}
								</Button>
								{canSetWithoutOld && requireOldPassword ? (
									<Link to="/app/account/password?mode=set">
										<Button type="button" variant="outline">I don’t know my current password</Button>
									</Link>
								) : null}
								{!requireOldPassword && canSetWithoutOld ? (
									<Link to="/app/account/password?mode=change">
										<Button type="button" variant="outline">I know my current password</Button>
									</Link>
								) : null}
							</div>
						</form>
					</Card>
				</div>
			)}
		</div>
	);
}
