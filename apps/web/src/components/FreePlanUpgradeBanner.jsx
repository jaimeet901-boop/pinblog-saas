import { Link, useLocation } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';

/**
 * Promotional upgrade banner for users on the Free plan only.
 * Uses existing auth plan state — no separate billing lookup.
 */
export default function FreePlanUpgradeBanner({ className = '' }) {
	const { user } = useAuth();
	const { pathname } = useLocation();
	const planSlug = String(user?.plan || 'free').toLowerCase();

	if (planSlug !== 'free') return null;
	if (pathname.startsWith('/app/subscription')) return null;

	return (
		<div
			className={`rounded-xl border border-primary/25 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-4 py-3 shadow-sm shadow-primary/10 ${className}`.trim()}
			role="status"
		>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-start gap-3 sm:items-center">
					<span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary sm:mt-0">
						<Sparkles size={16} aria-hidden />
					</span>
					<div className="min-w-0">
						<p className="text-sm font-semibold text-foreground">Unlock more with Pro</p>
						<p className="text-sm text-muted-foreground">
							Get higher AI limits, more generations, and access to premium features.
						</p>
					</div>
				</div>
				<Link to="/app/subscription" className="shrink-0 sm:ml-4">
					<Button size="sm" className="w-full sm:w-auto">
						Upgrade to Pro
					</Button>
				</Link>
			</div>
		</div>
	);
}
