import { PROVIDER_CATALOG } from './ai-provider-catalog.js';

function joinUrl(base, path) {
	const normalizedBase = String(base || '').replace(/\/+$/, '');
	const normalizedPath = String(path || '').replace(/^\/+/, '');
	return `${normalizedBase}/${normalizedPath}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
	const started = Date.now();
	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
		});
		const latencyMs = Date.now() - started;
		const text = await response.text().catch(() => '');
		return { response, latencyMs, text };
	} finally {
		clearTimeout(timer);
	}
}

function failure(message, latencyMs = 0) {
	return {
		ok: false,
		status: 'error',
		health: 'down',
		message,
		latencyMs,
		checkedAt: new Date().toISOString(),
	};
}

function success(message, latencyMs) {
	return {
		ok: true,
		status: 'connected',
		health: 'healthy',
		message,
		latencyMs,
		checkedAt: new Date().toISOString(),
	};
}

/**
 * Lightweight authenticated probe per provider.
 * Never logs or returns the API key.
 */
export async function probeProviderConnection({
	code,
	baseUrl,
	apiVersion,
	apiKey,
	organizationId,
	timeoutMs = 15000,
}) {
	if (!apiKey) {
		return failure('Missing API key. Configure credentials before testing.');
	}

	const catalog = PROVIDER_CATALOG.find((item) => item.code === code);
	const endpoint = (baseUrl || catalog?.base_url || '').trim();
	if (!endpoint) {
		return failure('Base URL is not configured.');
	}

	try {
		switch (code) {
			case 'openai':
			case 'deepseek':
			case 'grok':
			case 'openrouter': {
				const headers = {
					Authorization: `Bearer ${apiKey}`,
					Accept: 'application/json',
				};
				if (code === 'openai' && organizationId) {
					headers['OpenAI-Organization'] = organizationId;
				}
				if (code === 'openrouter') {
					headers['HTTP-Referer'] = 'https://chef-ia.app';
					headers['X-Title'] = 'Chef IA Admin';
				}
				const { response, latencyMs, text } = await fetchWithTimeout(
					joinUrl(endpoint, 'models'),
					{ method: 'GET', headers },
					timeoutMs,
				);
				if (!response.ok) {
					return failure(`Provider responded ${response.status}: ${text.slice(0, 180) || response.statusText}`, latencyMs);
				}
				return success(`${catalog?.name || code} responded in ${latencyMs}ms.`, latencyMs);
			}
			case 'mistral': {
				const { response, latencyMs, text } = await fetchWithTimeout(
					joinUrl(endpoint, 'v1/models'),
					{
						method: 'GET',
						headers: {
							Authorization: `Bearer ${apiKey}`,
							Accept: 'application/json',
						},
					},
					timeoutMs,
				);
				if (!response.ok) {
					return failure(`Provider responded ${response.status}: ${text.slice(0, 180) || response.statusText}`, latencyMs);
				}
				return success(`Mistral responded in ${latencyMs}ms.`, latencyMs);
			}
			case 'claude': {
				const { response, latencyMs, text } = await fetchWithTimeout(
					joinUrl(endpoint, 'v1/models'),
					{
						method: 'GET',
						headers: {
							'x-api-key': apiKey,
							'anthropic-version': apiVersion || '2023-06-01',
							Accept: 'application/json',
						},
					},
					timeoutMs,
				);
				if (!response.ok) {
					return failure(`Provider responded ${response.status}: ${text.slice(0, 180) || response.statusText}`, latencyMs);
				}
				return success(`Claude responded in ${latencyMs}ms.`, latencyMs);
			}
			case 'gemini': {
				const url = `${joinUrl(endpoint, 'models')}?key=${encodeURIComponent(apiKey)}`;
				const { response, latencyMs, text } = await fetchWithTimeout(
					url,
					{ method: 'GET', headers: { Accept: 'application/json' } },
					timeoutMs,
				);
				if (!response.ok) {
					return failure(`Provider responded ${response.status}: ${text.slice(0, 180) || response.statusText}`, latencyMs);
				}
				return success(`Gemini responded in ${latencyMs}ms.`, latencyMs);
			}
			case 'replicate': {
				const { response, latencyMs, text } = await fetchWithTimeout(
					joinUrl(endpoint, 'v1/account'),
					{
						method: 'GET',
						headers: {
							Authorization: `Bearer ${apiKey}`,
							Accept: 'application/json',
						},
					},
					timeoutMs,
				);
				if (!response.ok) {
					return failure(`Provider responded ${response.status}: ${text.slice(0, 180) || response.statusText}`, latencyMs);
				}
				return success(`Replicate responded in ${latencyMs}ms.`, latencyMs);
			}
			case 'fal': {
				const { response, latencyMs, text } = await fetchWithTimeout(
					'https://api.fal.ai/v1/models?limit=1',
					{
						method: 'GET',
						headers: {
							Authorization: `Key ${apiKey}`,
							Accept: 'application/json',
						},
					},
					timeoutMs,
				);
				if (!response.ok) {
					return failure(`Provider responded ${response.status}: ${text.slice(0, 180) || response.statusText}`, latencyMs);
				}
				return success(`Fal.ai responded in ${latencyMs}ms.`, latencyMs);
			}
			default:
				return failure(`Health checks are not implemented for provider "${code}".`);
		}
	} catch (error) {
		const message = error?.name === 'AbortError'
			? `Timed out after ${timeoutMs}ms`
			: (error?.message || 'Connection failed');
		return failure(message);
	}
}
