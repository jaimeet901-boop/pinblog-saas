/**
 * Authentication provider public status model.
 * Status values are Admin-facing; separate from publishing OAuth health.
 */

export const AUTH_PROVIDER_VERSION = '1.0.0';

export const AUTH_PROVIDER_STATUS = Object.freeze({
	CONNECTED: 'connected',
	NOT_CONFIGURED: 'not_configured',
	INVALID_CREDENTIALS: 'invalid_credentials',
	DISABLED: 'disabled',
	ENVIRONMENT_FALLBACK: 'environment_fallback',
	DATABASE_CONFIGURATION: 'database_configuration',
});

const STATUS_LABELS = Object.freeze({
	[AUTH_PROVIDER_STATUS.CONNECTED]: 'Connected',
	[AUTH_PROVIDER_STATUS.NOT_CONFIGURED]: 'Not Configured',
	[AUTH_PROVIDER_STATUS.INVALID_CREDENTIALS]: 'Invalid Credentials',
	[AUTH_PROVIDER_STATUS.DISABLED]: 'Disabled',
	[AUTH_PROVIDER_STATUS.ENVIRONMENT_FALLBACK]: 'Environment Fallback',
	[AUTH_PROVIDER_STATUS.DATABASE_CONFIGURATION]: 'Database Configuration',
});

/**
 * Derive a single primary status for pills + list UI.
 * Source (database vs environment) is also returned separately for metadata.
 */
export function deriveAuthProviderStatus({
	configurable = false,
	hasDatabaseRow = false,
	hasEnvCredentials = false,
	configured = false,
	enabled = false,
	lastTestOk = null,
	placeholder = false,
} = {}) {
	if (!configurable) {
		return {
			status: AUTH_PROVIDER_STATUS.NOT_CONFIGURED,
			statusLabel: 'Reserved',
			source: 'none',
			sourceLabel: 'Not Configured',
		};
	}

	const source = hasDatabaseRow
		? 'database'
		: (hasEnvCredentials ? 'environment' : 'none');
	const sourceLabel = source === 'database'
		? STATUS_LABELS[AUTH_PROVIDER_STATUS.DATABASE_CONFIGURATION]
		: (source === 'environment'
			? STATUS_LABELS[AUTH_PROVIDER_STATUS.ENVIRONMENT_FALLBACK]
			: STATUS_LABELS[AUTH_PROVIDER_STATUS.NOT_CONFIGURED]);

	if (!configured || placeholder) {
		return {
			status: AUTH_PROVIDER_STATUS.NOT_CONFIGURED,
			statusLabel: STATUS_LABELS[AUTH_PROVIDER_STATUS.NOT_CONFIGURED],
			source,
			sourceLabel,
		};
	}

	if (lastTestOk === false) {
		return {
			status: AUTH_PROVIDER_STATUS.INVALID_CREDENTIALS,
			statusLabel: STATUS_LABELS[AUTH_PROVIDER_STATUS.INVALID_CREDENTIALS],
			source,
			sourceLabel,
		};
	}

	if (!enabled) {
		return {
			status: AUTH_PROVIDER_STATUS.DISABLED,
			statusLabel: STATUS_LABELS[AUTH_PROVIDER_STATUS.DISABLED],
			source,
			sourceLabel,
		};
	}

	if (source === 'environment' && !hasDatabaseRow) {
		return {
			status: AUTH_PROVIDER_STATUS.ENVIRONMENT_FALLBACK,
			statusLabel: STATUS_LABELS[AUTH_PROVIDER_STATUS.ENVIRONMENT_FALLBACK],
			source,
			sourceLabel,
		};
	}

	if (source === 'database') {
		// Connected when DB-backed, enabled, and not known-invalid.
		return {
			status: AUTH_PROVIDER_STATUS.CONNECTED,
			statusLabel: STATUS_LABELS[AUTH_PROVIDER_STATUS.CONNECTED],
			source,
			sourceLabel: STATUS_LABELS[AUTH_PROVIDER_STATUS.DATABASE_CONFIGURATION],
		};
	}

	return {
		status: AUTH_PROVIDER_STATUS.CONNECTED,
		statusLabel: STATUS_LABELS[AUTH_PROVIDER_STATUS.CONNECTED],
		source,
		sourceLabel,
	};
}

export function authStatusToPillTone(status) {
	switch (status) {
		case AUTH_PROVIDER_STATUS.CONNECTED:
		case AUTH_PROVIDER_STATUS.DATABASE_CONFIGURATION:
			return 'healthy';
		case AUTH_PROVIDER_STATUS.ENVIRONMENT_FALLBACK:
			return 'configured';
		case AUTH_PROVIDER_STATUS.DISABLED:
			return 'degraded';
		case AUTH_PROVIDER_STATUS.INVALID_CREDENTIALS:
			return 'failed';
		case AUTH_PROVIDER_STATUS.NOT_CONFIGURED:
		default:
			return 'pending';
	}
}

export { STATUS_LABELS };
