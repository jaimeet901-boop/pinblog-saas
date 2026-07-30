import test from 'node:test';
import assert from 'node:assert/strict';
import {
	calculateHealthScore,
	deriveHealthStatus,
	toPublicHealthDto,
	toStoredHealthSnapshot,
} from './health-engine.js';
import { validateProvider } from './validation-engine.js';

test('validateProvider PayPal reports Not Implemented / FAIL', () => {
	const result = validateProvider('paypal', {}, {});
	assert.equal(result.result, 'FAIL');
	assert.ok(result.diagnostics.some((item) => item.code === 'not_implemented'));
});

test('validateProvider Stripe fails without credentials', () => {
	const prev = process.env.STRIPE_SECRET_KEY;
	const prevWh = process.env.STRIPE_WEBHOOK_SECRET;
	delete process.env.STRIPE_SECRET_KEY;
	delete process.env.STRIPE_WEBHOOK_SECRET;
	try {
		const result = validateProvider('stripe', { mode: 'test', enabled: true }, {});
		assert.equal(result.result, 'FAIL');
		assert.ok(result.diagnostics.some((item) => item.field === 'secretKey'));
		assert.ok(result.diagnostics.some((item) => item.field === 'webhookSecret'));
	} finally {
		if (prev !== undefined) process.env.STRIPE_SECRET_KEY = prev;
		else delete process.env.STRIPE_SECRET_KEY;
		if (prevWh !== undefined) process.env.STRIPE_WEBHOOK_SECRET = prevWh;
		else delete process.env.STRIPE_WEBHOOK_SECRET;
	}
});

test('validateProvider Stripe passes with env credentials', () => {
	process.env.STRIPE_SECRET_KEY = 'sk_test_x';
	process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
	try {
		const result = validateProvider('stripe', { mode: 'test', enabled: true }, {});
		assert.equal(result.result, 'PASS');
	} finally {
		delete process.env.STRIPE_SECRET_KEY;
		delete process.env.STRIPE_WEBHOOK_SECRET;
	}
});

test('validateProvider Lemon requires storeId', () => {
	process.env.LEMONSQUEEZY_API_KEY = 'ls_key';
	process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'whsec';
	delete process.env.LEMONSQUEEZY_STORE_ID;
	try {
		const result = validateProvider('lemonsqueezy', { mode: 'test', enabled: true }, {});
		assert.equal(result.result, 'FAIL');
		assert.ok(result.diagnostics.some((item) => item.field === 'storeId'));
	} finally {
		delete process.env.LEMONSQUEEZY_API_KEY;
		delete process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
	}
});

test('validateProvider Paddle warns without vendorId', () => {
	process.env.PADDLE_API_KEY = 'paddle_key';
	process.env.PADDLE_WEBHOOK_SECRET = 'whsec';
	delete process.env.PADDLE_VENDOR_ID;
	try {
		const result = validateProvider('paddle', { mode: 'test', enabled: true }, {});
		assert.equal(result.result, 'WARNING');
		assert.ok(result.diagnostics.some((item) => item.field === 'vendorId'));
	} finally {
		delete process.env.PADDLE_API_KEY;
		delete process.env.PADDLE_WEBHOOK_SECRET;
	}
});

test('calculateHealthScore is deterministic', () => {
	const a = calculateHealthScore({
		enabled: true,
		implemented: true,
		validationResult: 'PASS',
		connectivityOk: true,
		hasPrimaryCredential: true,
		hasWebhookSecret: true,
		hasEnvironment: true,
		lastError: null,
	});
	const b = calculateHealthScore({
		enabled: true,
		implemented: true,
		validationResult: 'PASS',
		connectivityOk: true,
		hasPrimaryCredential: true,
		hasWebhookSecret: true,
		hasEnvironment: true,
		lastError: null,
	});
	assert.equal(a, b);
	assert.equal(a, 100);
});

test('deriveHealthStatus maps score and validation', () => {
	assert.equal(deriveHealthStatus({
		enabled: true,
		implemented: true,
		validationResult: 'PASS',
		healthScore: 90,
		connectivityOk: true,
		everChecked: true,
	}), 'Healthy');
	assert.equal(deriveHealthStatus({
		enabled: true,
		implemented: true,
		validationResult: 'FAIL',
		healthScore: 20,
		connectivityOk: false,
		everChecked: true,
	}), 'Critical');
	assert.equal(deriveHealthStatus({
		enabled: false,
		implemented: true,
		everChecked: true,
	}), 'Offline');
	assert.equal(deriveHealthStatus({
		enabled: true,
		implemented: true,
		everChecked: false,
	}), 'Unknown');
});

test('toPublicHealthDto never invents fake scores', () => {
	const dto = toPublicHealthDto({});
	assert.equal(dto.healthScore, null);
	assert.equal(dto.status, 'Unknown');
	assert.equal(dto.lastHealthCheck, null);
});

test('toStoredHealthSnapshot keeps latest-only safe fields', () => {
	const stored = toStoredHealthSnapshot({
		provider: 'stripe',
		checkedAt: '2026-01-01T00:00:00.000Z',
		auto: false,
		healthScore: 80,
		status: 'Healthy',
		validation: {
			result: 'PASS',
			summary: 'ok',
			diagnostics: [{ code: 'x', message: 'm', severity: 'info', field: 'mode', secretKey: 'leak' }],
			checks: { credentials: true },
		},
		connectivity: { ok: true, message: 'reachable', checkedAt: '2026-01-01T00:00:00.000Z' },
		lastError: null,
		lastValidation: '2026-01-01T00:00:00.000Z',
		lastHealthCheck: '2026-01-01T00:00:00.000Z',
	});
	assert.equal(stored.healthScore, 80);
	assert.equal(stored.validation.diagnostics[0].secretKey, undefined);
	assert.equal(stored.validation.diagnostics[0].message, 'm');
});
