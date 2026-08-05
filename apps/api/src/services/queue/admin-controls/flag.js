/**
 * Admin Queue channel control routing gate (Phase 9d-3). Unset defaults to disabled.
 */
export function isAdminQueueChannelControlsEnabled() {
	const raw = String(process.env.ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED ?? '').trim().toLowerCase();
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

export function getAdminQueueChannelControlsStatus() {
	const enabled = isAdminQueueChannelControlsEnabled();
	return {
		enabled,
		disabledByEnv: !enabled,
	};
}
