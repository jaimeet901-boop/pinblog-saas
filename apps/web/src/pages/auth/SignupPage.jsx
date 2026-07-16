import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AuthShell from './AuthShell';
import { Button, Input, Spinner } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { OAUTH_PROVIDERS, normalizePocketBaseError, validateSignupForm } from '@/lib/auth';

function OAuthButton({ provider, disabled, loading, onClick }) {
	return (
		<Button
			type="button"
			variant="outline"
			disabled={disabled || loading}
			onClick={onClick}
			className="h-12 w-full justify-between border-border/70 bg-card px-4 text-left shadow-sm hover:bg-secondary/70"
		>
			<span className="flex items-center gap-3">
				<span className={`flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ${provider.accent}`}>
					{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : provider.badge}
				</span>
				<span>
					<span className="block text-sm font-medium">{provider.label}</span>
					<span className="block text-xs text-muted-foreground">{provider.description}</span>
				</span>
			</span>
			<span className="text-xs font-medium text-muted-foreground">Continue</span>
		</Button>
	);
}

export default function SignupPage() {
	const { signup, loginWithOAuth, authMethods } = useAuth();
	const navigate = useNavigate();
	const { toast } = useToast();
	const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
	const [loading, setLoading] = useState(false);
	const [oauthLoading, setOauthLoading] = useState('');

	const enabledProviders = useMemo(() => new Set((authMethods?.oauth2?.providers || []).map((provider) => provider.name)), [authMethods]);

	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

	const startOAuth = async (provider) => {
		const popup = window.open('', 'pb-oauth', 'popup=yes,width=560,height=720');
		if (!popup) {
			toast({ variant: 'destructive', title: 'Popup blocked', description: 'Please allow popups to continue with this provider.' });
			return;
		}

		setOauthLoading(provider);
		try {
			await loginWithOAuth(provider, popup);
			toast({ title: 'Account ready', description: `Signed in with ${OAUTH_PROVIDERS[provider].label}.` });
			navigate('/app');
		} catch (error) {
			toast({ variant: 'destructive', title: `${OAUTH_PROVIDERS[provider].label} sign-up failed`, description: normalizePocketBaseError(error, 'Could not complete the OAuth flow.') });
		} finally {
			if (!popup.closed) {
				popup.close();
			}
			setOauthLoading('');
		}
	};

	const submit = async (e) => {
		e.preventDefault();
		const validationErrors = validateSignupForm(form);
		if (validationErrors.length > 0) {
			toast({ variant: 'destructive', title: 'Check your details', description: validationErrors[0] });
			return;
		}
		setLoading(true);
		try {
			await signup(form.name.trim(), form.email.trim(), form.password);
			toast({ title: 'Welcome to Chef IA!', description: 'Your account is ready. Check your inbox to verify your email.' });
			navigate('/app');
		} catch (err) {
			toast({ variant: 'destructive', title: 'Signup failed', description: normalizePocketBaseError(err, 'Could not create your account.') });
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
			<div className="space-y-4">
				<div className="space-y-3">
					<OAuthButton
						provider={OAUTH_PROVIDERS.google}
						disabled={enabledProviders.size > 0 && !enabledProviders.has('google')}
						loading={oauthLoading === 'google'}
						onClick={() => startOAuth('google')}
					/>
					<OAuthButton
						provider={OAUTH_PROVIDERS.pinterest}
						disabled={enabledProviders.size > 0 && !enabledProviders.has('pinterest')}
						loading={oauthLoading === 'pinterest'}
						onClick={() => startOAuth('pinterest')}
					/>
				</div>

				<div className="flex items-center gap-3">
					<div className="h-px flex-1 bg-border" />
					<span className="text-xs font-semibold tracking-[0.24em] text-muted-foreground">OR</span>
					<div className="h-px flex-1 bg-border" />
				</div>

				<form onSubmit={submit} className="space-y-4">
					<Input label="Full Name" required value={form.name} onChange={set('name')} placeholder="Jamie Rivera" />
					<Input label="Email" type="email" required value={form.email} onChange={set('email')} placeholder="you@blog.com" />
					<Input label="Password" type="password" required value={form.password} onChange={set('password')} placeholder="At least 10 characters" />
					<Input label="Confirm Password" type="password" required value={form.confirmPassword} onChange={set('confirmPassword')} placeholder="Repeat your password" />
					<Button type="submit" disabled={loading} className="w-full">
						{loading ? <Spinner /> : 'Create account with email'}
					</Button>
				</form>
			</div>
		</AuthShell>
	);
}
