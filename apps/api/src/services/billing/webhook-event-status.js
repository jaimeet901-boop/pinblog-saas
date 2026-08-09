export function isTerminalWebhookStatus(status = '') {
	return ['processed', 'ignored', 'duplicate'].includes(String(status || '').trim());
}

export function canRetryWebhookEvent(record = {}) {
	const status = String(record?.status || '').trim();
	return status === 'failed' || status === 'received' || status === 'processing';
}

export function sanitizeWebhookPayloadForStorage(payload = {}) {
	if (!payload || typeof payload !== 'object') return {};
	const clone = JSON.parse(JSON.stringify(payload));
	const redactKeys = ['authorization', 'api_key', 'apiKey', 'webhook_secret', 'webhookSecret', 'secret'];
	const walk = (obj) => {
		if (!obj || typeof obj !== 'object') return;
		for (const key of Object.keys(obj)) {
			if (redactKeys.includes(String(key).toLowerCase())) {
				obj[key] = '[REDACTED]';
				continue;
			}
			if (typeof obj[key] === 'object') walk(obj[key]);
		}
	};
	walk(clone);
	return clone;
}
