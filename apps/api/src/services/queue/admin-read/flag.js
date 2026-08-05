/**
 * Admin Queue dual-read gate (Phase 9d-2). Unset defaults to disabled.
 */
export function isAdminQueueDualReadEnabled() {
	const raw = String(process.env.ADMIN_QUEUE_DUAL_READ_ENABLED ?? '').trim().toLowerCase();
	if (!raw) {
		return false;
	}
	if (raw === '1' || raw === 'true') {
		return true;
	}
	if (raw === '0' || raw === 'false') {
		return false;
	}
	return false;
}

export function getAdminQueueDualReadStatus() {
	const enabled = isAdminQueueDualReadEnabled();
	return {
		enabled,
		disabledByEnv: !enabled,
	};
}
