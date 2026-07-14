import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthShell from './AuthShell';
import { Button, Input, Spinner } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

export default function SignupPage() {
	const { signup } = useAuth();
	const navigate = useNavigate();
	const { toast } = useToast();
	const [form, setForm] = useState({ name: '', email: '', password: '' });
	const [loading, setLoading] = useState(false);

	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

	const submit = async (e) => {
		e.preventDefault();
		if (form.password.length < 8) {
			toast({ variant: 'destructive', title: 'Weak password', description: 'Use at least 8 characters.' });
			return;
		}
		setLoading(true);
		try {
			await signup(form.name, form.email, form.password);
			toast({ title: 'Welcome to Chef IA!', description: 'Check your inbox to verify your email.' });
			navigate('/app');
		} catch (err) {
			toast({ variant: 'destructive', title: 'Signup failed', description: err?.response?.data ? 'Email may already be in use.' : err?.message });
		} finally {
			setLoading(false);
		}
	};

	return (
		<AuthShell
			title="Create your account"
			subtitle="Start generating SEO content for free."
			footer={<>Already have an account? <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link></>}
		>
			<form onSubmit={submit} className="space-y-4">
				<Input label="Name" required value={form.name} onChange={set('name')} placeholder="Jamie Rivera" />
				<Input label="Email" type="email" required value={form.email} onChange={set('email')} placeholder="you@blog.com" />
				<Input label="Password" type="password" required value={form.password} onChange={set('password')} placeholder="At least 8 characters" />
				<Button type="submit" disabled={loading} className="w-full">
					{loading ? <Spinner /> : 'Create account'}
				</Button>
			</form>
		</AuthShell>
	);
}
