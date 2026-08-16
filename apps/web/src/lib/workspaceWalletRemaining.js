/**
 * Customer-facing workspace wallet remaining.
 * Source of truth is credits.remaining / credits.balance from the workspace wallet DTO.
 * Never derive remaining from quota - used.
 */

export function workspaceWalletRemaining(source = {}) {
	const value = source?.remaining ?? source?.balance;
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
}

export function planCreditsIncludedPerMonth(source = {}) {
	const value = source?.quota ?? source?.credits ?? source?.monthlyQuota ?? source?.limit;
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Analytics range usage is not wallet remaining.
 * Never take remaining from a Pinterest analytics fallback payload.
 */
export function mergeAnalyticsCreditsDisplay({
	overviewOk = false,
	summary = {},
	walletRemaining,
	previousRemaining = 0,
} = {}) {
	let remaining;
	if (walletRemaining != null && Number.isFinite(Number(walletRemaining))) {
		remaining = Number(walletRemaining);
	} else if (overviewOk) {
		remaining = workspaceWalletRemaining(summary);
	} else {
		remaining = workspaceWalletRemaining({ remaining: previousRemaining });
	}

	const rangeRaw = overviewOk ? summary?.creditsUsed : null;
	const creditsUsedInRange = Number.isFinite(Number(rangeRaw)) ? Number(rangeRaw) : 0;

	return {
		creditsRemaining: remaining,
		creditsUsedInRange,
	};
}
