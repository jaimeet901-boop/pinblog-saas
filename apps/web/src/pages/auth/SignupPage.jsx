import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AuthShell from './AuthShell';
import { Button, Input, Spinner } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';
import {
	OAUTH_PROVIDERS,
	getAuthPageOAuthProviders,
	getPasswordIssues,
	isValidEmail,
	normalizePocketBaseError,
	validateSignupForm,
} from '@/lib/auth';
import { R0_AUTH } from '@/lib/marketing/r0Copy';

function OAuthButton({ provider, disabled, loading, onClick }) {
	const label = `Continue with ${provider.label}`;
	return (
		<Button
			type="button"
			variant="outline"
			disabled={disabled || loading}
			onClick={onClick}
			aria-label={loading ? `Creating account with ${provider.label}` : label}
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

const EMPTY_ERRORS = {
	name: '',
	workspaceName: '',
	email: '',
	password: '',
	confirmPassword: '',
	acceptTerms: '',
	form: '',
};

export default function SignupPage() {
	const { signup, loginWithOAuth, authMethods } = useAuth();
	const { platformName } = usePlatformIdentity();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const { toast } = useToast();
	const [form, setForm] = useState({
		name: '',
		workspaceName: '',
		email: searchParams.get('email') || '',
		password: '',
		confirmPassword: '',
		acceptTerms: false,
	});
	const [loading, setLoading] = useState(false);
	const [oauthLoading, setOauthLoading] = useState('');
	const [fieldErrors, setFieldErrors] = useState(EMPTY_ERRORS);

	useEffect(() => {
		const email = searchParams.get('email');
		if (email) setForm((prev) => ({ ...prev, email }));
	}, [searchParams]);

	const enabledProviders = useMemo(() => new Set((authMethods?.oauth2?.providers || []).map((provider) => provider.name)), [authMethods]);
	const authPageProviders = useMemo(() => getAuthPageOAuthProviders(), []);

	const set = (k) => (e) => {
		const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
		setForm((f) => ({ ...f, [k]: value }));
		setFieldErrors((prev) => (prev[k] || prev.form ? { ...prev, [k]: '', form: '' } : prev));
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

	const buildInlineErrors = () => {
		const next = { ...EMPTY_ERRORS };
		if (!String(form.name || '').trim()) next.name = 'Full name is required.';
		if (!isValidEmail(form.email)) next.email = 'Enter a valid email address.';
		const passwordIssues = getPasswordIssues(form.password);
		if (passwordIssues.length > 0) next.password = passwordIssues[0];
		if (String(form.password || '') !== String(form.confirmPassword || '')) {
			next.confirmPassword = 'Passwords do not match.';
		}
		if (!form.acceptTerms) next.acceptTerms = 'Please accept the Terms to create your workspace.';
		return next;
	};

	const submit = async (e) => {
		e.preventDefault();
		const nextErrors = buildInlineErrors();
		const hasInline = Object.entries(nextErrors).some(([key, value]) => key !== 'form' && value);
		if (hasInline) {
			setFieldErrors(nextErrors);
			const first = Object.values(nextErrors).find(Boolean);
			toast({ variant: 'destructive', title: 'Check your details', description: first });
			return;
		}

		const validationErrors = validateSignupForm({
			name: form.name,
			email: form.email,
			password: form.password,
			confirmPassword: form.confirmPassword,
		});
		if (validationErrors.length > 0) {
			setFieldErrors({ ...EMPTY_ERRORS, form: validationErrors[0] });
			toast({ variant: 'destructive', title: 'Check your details', description: validationErrors[0] });
			return;
		}

		setLoading(true);
		setFieldErrors(EMPTY_ERRORS);
		try {
			await signup(form.name.trim(), form.email.trim(), form.password);
			const inviteToken = searchParams.get('invite');
			if (inviteToken) {
				try {
					const { default: apiServerClient } = await import('@/lib/apiServerClient');
					await apiServerClient.fetch('/workspace/v1/members/accept', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ token: inviteToken }),
					});
				} catch {
					/* claimPendingInvites still runs on first workspace resolve */
				}
			}
			toast({ title: `Welcome to ${platformName}!`, description: 'Your account is ready. Check your inbox to verify your email.' });
			navigate('/app');
		} catch (err) {
			const message = normalizePocketBaseError(err, 'Could not create your account.');
			setFieldErrors({ ...EMPTY_ERRORS, form: message });
			toast({ variant: 'destructive', title: 'Signup failed', description: message });
		} finally {
			setLoading(false);
		}
	};

	return (
		<AuthShell
			seoPage="signup"
			title="Create your workspace"
			subtitle={R0_AUTH.signupSubtitle}
			footer={<>Already have an account? <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link></>}
		>
			<div className="space-y-4">
				{authPageProviders.length > 0 ? (
					<div className="space-y-3">
						{authPageProviders.map((provider) => (
							<OAuthButton
								key={provider.name}
								provider={provider}
								disabled={enabledProviders.size > 0 && !enabledProviders.has(provider.name)}
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
						<p id="signup-form-error" className="auth-field-error" role="alert">{fieldErrors.form}</p>
					) : null}
					<Input
						label="Full Name"
						name="name"
						autoComplete="name"
						required
						value={form.name}
						onChange={set('name')}
						placeholder="Jamie Rivera"
						error={fieldErrors.name}
					/>
					<Input
						label="Workspace Name"
						name="organization"
						autoComplete="organization"
						value={form.workspaceName}
						onChange={set('workspaceName')}
						placeholder="My Food Blog"
						error={fieldErrors.workspaceName}
					/>
					<Input
						label="Email"
						type="email"
						name="email"
						autoComplete="email"
						required
						value={form.email}
						onChange={set('email')}
						placeholder="you@blog.com"
						error={fieldErrors.email}
					/>
					<Input
						label="Password"
						type="password"
						name="password"
						autoComplete="new-password"
						required
						value={form.password}
						onChange={set('password')}
						placeholder="At least 10 characters"
						error={fieldErrors.password}
					/>
					<Input
						label="Confirm Password"
						type="password"
						name="confirmPassword"
						autoComplete="new-password"
						required
						value={form.confirmPassword}
						onChange={set('confirmPassword')}
						placeholder="Repeat your password"
						error={fieldErrors.confirmPassword}
					/>
					<label className="auth-check">
						<input
							type="checkbox"
							name="acceptTerms"
							checked={form.acceptTerms}
							onChange={set('acceptTerms')}
							required
							aria-invalid={fieldErrors.acceptTerms ? true : undefined}
							aria-describedby={fieldErrors.acceptTerms ? 'signup-terms-error' : undefined}
						/>
						<span>
							I agree to the <Link to="/terms" className="text-primary hover:underline">Terms</Link> and{' '}
							<Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
						</span>
					</label>
					{fieldErrors.acceptTerms ? (
						<p id="signup-terms-error" className="auth-field-error" role="alert">{fieldErrors.acceptTerms}</p>
					) : null}
					<Button type="submit" disabled={loading} aria-busy={loading || undefined} className="w-full">
						{loading ? <Spinner /> : 'Create Workspace'}
					</Button>
				</form>
			</div>
		</AuthShell>
	);
}
