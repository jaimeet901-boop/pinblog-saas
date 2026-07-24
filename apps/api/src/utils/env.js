import { NodeEnv } from '../constants/common.js';

function normalizeString(value) {
	if (typeof value !== 'string') {
		return '';
	}
	return value.trim();
}

export function getEnv(name, fallback = '') {
	const value = normalizeString(process.env[name]);
	return value || fallback;
}

export function getRequiredEnv(name) {
	const value = normalizeString(process.env[name]);
	if (!value) {
		const error = new Error(`Missing required environment variable: ${name}`);
		error.status = 500;
		throw error;
	}
	return value;
}

export function isProduction() {
	return normalizeString(process.env.NODE_ENV).toLowerCase() === NodeEnv.Production;
}

export function validateServerEnv() {
	const required = [
		'PB_SUPERUSER_EMAIL',
		'PB_SUPERUSER_PASSWORD',
		'PINTEREST_CLIENT_ID',
		'PINTEREST_CLIENT_SECRET',
	];

	const missing = required.filter((name) => !normalizeString(process.env[name]));
	if (missing.length > 0) {
		throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
	}

	const integratedAiOptional = [
		'INTEGRATED_AI_API_URL',
		'INTEGRATED_AI_API_KEY',
		'WEBSITE_ID',
	];
	const missingIntegratedAi = integratedAiOptional.filter((name) => !normalizeString(process.env[name]));
	if (missingIntegratedAi.length > 0) {
		// Do not block API boot — surface a clear 503 from stream() when Generate is used.
		console.warn(
			`[env] Integrated AI Generate is not fully configured (missing: ${missingIntegratedAi.join(', ')}). `
			+ 'Set these in apps/api/.env and recreate the api container.',
		);
	}
}
