import { Link, useLocation } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/kit';
import { useWorkspace } from '@/context/WorkspaceContext';
import { isActiveWorkspaceOnFreePlan } from '@/lib/activeWorkspacePlan';

/**
 * Promotional upgrade banner for workspaces on the Free plan only.
 * Uses the active workspace plan — not PocketBase users.plan / authStore.
 */
export default function FreePlanUpgradeBanner({ className = '' }) {
	const { activeWorkspace } = useWorkspace();
	const { pathname } = useLocation();

	if (!isActiveWorkspaceOnFreePlan(activeWorkspace)) return null;
	if (pathname.startsWith('/app/subscription')) return null;

	return (
		<div
			className={`rounded-xl border border-red-500/35 bg-gradient-to-r from-red-600/15 via-red-500/10 to-red-500/5 px-4 py-3 shadow-sm shadow-red-500/15 ${className}`.trim()}
			role="status"
		>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-start gap-3 sm:items-center">
					<span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-600/15 text-red-700 dark:bg-red-500/25 dark:text-red-200 sm:mt-0">
						<Sparkles size={16} aria-hidden />
					</span>
					<div className="min-w-0">
						<p className="text-sm font-semibold text-red-950 dark:text-red-50">Unlock more with Pro</p>
						<p className="text-sm text-red-900/85 dark:text-red-100/90">
							Get higher AI limits, more generations, and access to premium features.
						</p>
					</div>
				</div>
				<Link to="/app/subscription#bill-upgrade-plans" className="shrink-0 sm:ml-4">
					<Button size="sm" className="w-full border-red-700/20 bg-red-700 text-white hover:bg-red-800 sm:w-auto dark:bg-red-600 dark:hover:bg-red-700">
						Upgrade to Pro
					</Button>
				</Link>
			</div>
		</div>
	);
}
