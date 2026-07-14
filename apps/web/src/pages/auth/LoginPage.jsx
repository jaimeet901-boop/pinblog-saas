import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthShell from './AuthShell';
import { Button, Input, Spinner } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

export default function LoginPage() {
	const { login } = useAuth();
	const navigate = useNavigate();
	const { toast } = useToast();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [loading, setLoading] = useState(false);

	const submit = async (e) => {
		e.preventDefault();
		setLoading(true);
		try {
			await login(email, password);
			navigate('/app');
		} catch (err) {
			toast({ variant: 'destructive', title: 'Login failed', description: err?.message || 'Check your credentials.' });
		} finally {
			setLoading(false);
		}
	};

	return (
		<AuthShell
			title="Welcome back"
			subtitle="Sign in to your Chef IA workspace."
			footer={<>No account? <Link to="/signup" className="font-medium text-primary hover:underline">Create one</Link></>}
		>
			<form onSubmit={submit} className="space-y-4">
				<Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@blog.com" />
				<Input label="Password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
				<div className="flex justify-end">
					<Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground">Forgot password?</Link>
				</div>
				<Button type="submit" disabled={loading} className="w-full">
					{loading ? <Spinner /> : 'Sign in'}
				</Button>
			</form>
		</AuthShell>
	);
}
