/**
 * Paddle environment resolution tests.
 * Run: node --test src/services/billing/providers/paddle-environment.test.js
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	deriveEffectivePaddleEnvironment,
	resolvePaddleApiBase,
} from './paddle-environment.js';

describe('deriveEffectivePaddleEnvironment', () => {
	const originalSandbox = process.env.PADDLE_SANDBOX;

	afterEach(() => {
		if (originalSandbox === undefined) delete process.env.PADDLE_SANDBOX;
		else process.env.PADDLE_SANDBOX = originalSandbox;
	});

	it('returns sandbox when sandbox flag set', () => {
		const result = deriveEffectivePaddleEnvironment({ sandbox: true });
		assert.equal(result.ok, true);
		assert.equal(result.environment, 'sandbox');
	});

	it('returns live when mode is live and sandbox false', () => {
		const result = deriveEffectivePaddleEnvironment({ sandbox: false, mode: 'live' });
		assert.equal(result.environment, 'live');
	});

	it('fails closed on sandbox/live conflict', () => {
		process.env.PADDLE_SANDBOX = '1';
		const result = deriveEffectivePaddleEnvironment({ sandbox: true, mode: 'live' });
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_environment_conflict_sandbox_and_live');
	});
});

describe('resolvePaddleApiBase', () => {
	it('maps environments to API hosts', () => {
		assert.equal(resolvePaddleApiBase('sandbox'), 'https://sandbox-api.paddle.com');
		assert.equal(resolvePaddleApiBase('live'), 'https://api.paddle.com');
		assert.equal(resolvePaddleApiBase('unknown'), null);
	});
});
