import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AuthShell from './AuthShell';
import { Button, Input, Spinner } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { OAUTH_PROVIDERS, isValidEmail, normalizePocketBaseError } from '@/lib/auth';

const REMEMBER_KEY = 'chef-ia-remember-email';

function OAuthButton({ provider, disabled, loading, onClick }) {
	return (
		<Button
			type="button"
			variant="outline"
			disabled={disabled || loading}
			onClick={onClick}
			className="h-12 w-full justify-between border-border/70 bg-card/80 px-4 text-left shadow-sm hover:bg-secondary/70"
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

export default function LoginPage() {
	const { login, loginWithOAuth, authMethods } = useAuth();
	const navigate = useNavigate();
	const { toast } = useToast();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [rememberMe, setRememberMe] = useState(false);
	const [loading, setLoading] = useState(false);
	const [oauthLoading, setOauthLoading] = useState('');

	const enabledProviders = useMemo(() => new Set((authMethods?.oauth2?.providers || []).map((provider) => provider.name)), [authMethods]);

	useEffect(() => {
		try {
			const saved = localStorage.getItem(REMEMBER_KEY);
			if (saved) {
				setEmail(saved);
				setRememberMe(true);
			}
		} catch {
			/* ignore */
		}
	}, []);

	const startOAuth = async (provider) => {
		const popup = window.open('', 'pb-oauth', 'popup=yes,width=560,height=720');
		if (!popup) {
			toast({ variant: 'destructive', title: 'Popup blocked', description: 'Please allow popups to continue with this provider.' });
			return;
		}

		setOauthLoading(provider);
		try {
			await loginWithOAuth(provider, popup);
			toast({ title: 'Signed in', description: `Welcome back with ${OAUTH_PROVIDERS[provider].label}.` });
			navigate('/app');
		} catch (error) {
			toast({ variant: 'destructive', title: `${OAUTH_PROVIDERS[provider].label} sign-in failed`, description: normalizePocketBaseError(error, 'Could not complete the sign-in flow.') });
		} finally {
			if (!popup.closed) {
				popup.close();
			}
			setOauthLoading('');
		}
	};

	const submit = async (e) => {
		e.preventDefault();
		if (!isValidEmail(email)) {
			toast({ variant: 'destructive', title: 'Invalid email', description: 'Enter a valid email address.' });
			return;
		}
		setLoading(true);
		try {
			await login(email, password);
			try {
				if (rememberMe) {
					localStorage.setItem(REMEMBER_KEY, email.trim());
				} else {
					localStorage.removeItem(REMEMBER_KEY);
				}
			} catch {
				/* ignore */
			}
			toast({ title: 'Signed in', description: 'Your workspace is ready.' });
			navigate('/app');
		} catch (err) {
			toast({ variant: 'destructive', title: 'Login failed', description: normalizePocketBaseError(err, 'Check your credentials and try again.') });
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

				<div className="auth-divider"><span>OR</span></div>

				<form onSubmit={submit} className="space-y-4">
					<Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@blog.com" />
					<Input label="Password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
					<div className="flex items-center justify-between gap-3">
						<label className="auth-check">
							<input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
							<span>Remember me</span>
						</label>
						<Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground">Forgot password?</Link>
					</div>
					<Button type="submit" disabled={loading} className="w-full">
						{loading ? <Spinner /> : 'Login'}
					</Button>
				</form>
			</div>
		</AuthShell>
	);
}
