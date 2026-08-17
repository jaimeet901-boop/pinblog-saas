import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AuthShell from './AuthShell';
import { Button, Input, Spinner } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';
import { useToast } from '@/hooks/use-toast';
import { OAUTH_PROVIDERS, getLiveAuthPageOAuthProviders, isValidEmail, normalizeEmail, normalizePocketBaseError } from '@/lib/auth';
import { R0_AUTH } from '@/lib/marketing/r0Copy';

const REMEMBER_KEY = 'chef-ia-remember-email';

function OAuthButton({ provider, disabled, loading, onClick }) {
	const label = `Continue with ${provider.label}`;
	return (
		<Button
			type="button"
			variant="outline"
			disabled={disabled || loading}
			onClick={onClick}
			aria-label={loading ? `Signing in with ${provider.label}` : label}
			aria-busy={loading || undefined}
			className="auth-oauth-btn h-12 w-full justify-between px-4 text-left"
		>
			<span className="flex items-center gap-3">
				<span
					className={`flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ${provider.accent}`}
					aria-hidden="true"
				>
					{loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : provider.badge}
				</span>
				<span aria-hidden="true">
					<span className="block text-sm font-medium">{provider.label}</span>
					<span className="block text-xs text-muted-foreground">{provider.description}</span>
				</span>
			</span>
			<span className="text-xs font-medium text-muted-foreground" aria-hidden="true">
				{loading ? 'Connecting…' : 'Continue'}
			</span>
		</Button>
	);
}

export default function LoginPage() {
	const { login, loginWithOAuth, authMethods } = useAuth();
	const { platformName } = usePlatformIdentity();
	const navigate = useNavigate();
	const { toast } = useToast();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [rememberMe, setRememberMe] = useState(false);
	const [loading, setLoading] = useState(false);
	const [oauthLoading, setOauthLoading] = useState('');
	const [fieldErrors, setFieldErrors] = useState({ email: '', password: '', form: '' });

	const authPageProviders = useMemo(() => getLiveAuthPageOAuthProviders(authMethods), [authMethods]);

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

	const clearFieldError = (key) => {
		setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: '', form: '' } : prev));
	};

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
		const nextErrors = { email: '', password: '', form: '' };
		if (!isValidEmail(email)) {
			nextErrors.email = 'Enter a valid email address.';
		}
		if (!String(password || '').trim()) {
			nextErrors.password = 'Enter your password.';
		}
		if (nextErrors.email || nextErrors.password) {
			setFieldErrors(nextErrors);
			toast({ variant: 'destructive', title: 'Check your details', description: nextErrors.email || nextErrors.password });
			return;
		}

		setLoading(true);
		setFieldErrors({ email: '', password: '', form: '' });
		const normalized = normalizeEmail(email);
		try {
			await login(normalized, password);
			try {
				if (rememberMe) {
					localStorage.setItem(REMEMBER_KEY, normalized);
				} else {
					localStorage.removeItem(REMEMBER_KEY);
				}
			} catch {
				/* ignore */
			}
			toast({ title: 'Signed in', description: 'Your workspace is ready.' });
			navigate('/app');
		} catch (err) {
			const message = normalizePocketBaseError(err, 'Check your credentials and try again.');
			setFieldErrors({ email: '', password: '', form: message });
			toast({ variant: 'destructive', title: 'Login failed', description: message });
		} finally {
			setLoading(false);
		}
	};

	return (
		<AuthShell
			seoPage="login"
			title="Welcome back"
			subtitle={R0_AUTH.loginSubtitle.replace('Chef IA', platformName)}
			footer={<>No account? <Link to="/signup" className="font-medium text-primary hover:underline">Create one</Link></>}
		>
			<div className="space-y-4">
				{authPageProviders.length > 0 ? (
					<div className="space-y-3">
						{authPageProviders.map((provider) => (
							<OAuthButton
								key={provider.name}
								provider={provider}
								loading={oauthLoading === provider.name}
								onClick={() => startOAuth(provider.name)}
							/>
						))}
					</div>
				) : null}

				{authPageProviders.length > 0 ? (
					<div className="auth-divider"><span>OR</span></div>
				) : null}

				<form onSubmit={submit} className="space-y-4" noValidate>
					{fieldErrors.form ? (
						<p id="login-form-error" className="auth-field-error" role="alert">{fieldErrors.form}</p>
					) : null}
					<Input
						label="Email"
						type="email"
						name="email"
						autoComplete="username"
						required
						value={email}
						onChange={(e) => {
							setEmail(e.target.value);
							clearFieldError('email');
						}}
						placeholder="you@blog.com"
						error={fieldErrors.email}
						aria-describedby={fieldErrors.form ? 'login-form-error' : undefined}
					/>
					<Input
						label="Password"
						type="password"
						name="password"
						autoComplete="current-password"
						required
						value={password}
						onChange={(e) => {
							setPassword(e.target.value);
							clearFieldError('password');
						}}
						placeholder="••••••••"
						error={fieldErrors.password}
						aria-describedby={fieldErrors.form ? 'login-form-error' : undefined}
					/>
					<div className="flex items-center justify-between gap-3">
						<label className="auth-check">
							<input
								type="checkbox"
								name="remember"
								checked={rememberMe}
								onChange={(e) => setRememberMe(e.target.checked)}
							/>
							<span>Remember me</span>
						</label>
						<Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground">Forgot password?</Link>
					</div>
					<Button type="submit" disabled={loading} aria-busy={loading || undefined} className="w-full">
						{loading ? <Spinner /> : 'Login'}
					</Button>
				</form>
			</div>
		</AuthShell>
	);
}
