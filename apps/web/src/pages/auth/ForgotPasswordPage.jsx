import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthShell from './AuthShell';
import { Button, Input, Spinner } from '@/components/kit';
import pb from '@/lib/pocketbaseClient';
import { useToast } from '@/hooks/use-toast';

export default function ForgotPasswordPage() {
	const { toast } = useToast();
	const [email, setEmail] = useState('');
	const [loading, setLoading] = useState(false);
	const [sent, setSent] = useState(false);

	const submit = async (e) => {
		e.preventDefault();
		setLoading(true);
		try {
			await pb.collection('users').requestPasswordReset(email);
			setSent(true);
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message || 'Could not send reset email.' });
		} finally {
			setLoading(false);
		}
	};

	return (
		<AuthShell
			title="Reset password"
			subtitle="We'll email you a secure reset link."
			footer={<Link to="/login" className="font-medium text-primary hover:underline">Back to login</Link>}
		>
			{sent ? (
				<div className="rounded-xl border border-border bg-secondary p-4 text-sm">
					If an account exists for <span className="font-medium">{email}</span>, a reset link is on its way.
				</div>
			) : (
				<form onSubmit={submit} className="space-y-4">
					<Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@blog.com" />
					<Button type="submit" disabled={loading} className="w-full">
						{loading ? <Spinner /> : 'Send reset link'}
					</Button>
				</form>
			)}
		</AuthShell>
	);
}
