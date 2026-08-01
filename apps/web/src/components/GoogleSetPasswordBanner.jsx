import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { isPasswordKnownLocally } from '@/lib/passwordKnown';

/**
 * Shown when the user is signed in with Google and has not set a known password
 * in this browser (OAuth-only or PocketBase random-reset after Google link).
 */
export default function GoogleSetPasswordBanner({ className = '' }) {
	const { user, externalAuths } = useAuth();
	const googleLinked = (externalAuths || []).some(
		(item) => String(item?.provider || '').toLowerCase() === 'google',
	);
	const known = isPasswordKnownLocally(user?.id);

	if (!googleLinked || known) return null;

	return (
		<div
			className={`rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 ${className}`.trim()}
			role="status"
		>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<p className="text-sm text-amber-950 dark:text-amber-100">
					You are currently signed in using Google. You can set a password to allow future email/password login.
				</p>
				<Link to="/app/account/password?mode=set" className="shrink-0">
					<Button size="sm" variant="outline">
						<KeyRound size={14} /> Set Password
					</Button>
				</Link>
			</div>
		</div>
	);
}
