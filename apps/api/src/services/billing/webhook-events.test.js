/**
 * Webhook event persistence helpers (pure logic tests).
 * Run: node --test src/services/billing/webhook-events.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	canRetryWebhookEvent,
	isTerminalWebhookStatus,
} from './webhook-event-status.js';

describe('webhook event status helpers', () => {
	it('marks processed/ignored/duplicate as terminal', () => {
		assert.equal(isTerminalWebhookStatus('processed'), true);
		assert.equal(isTerminalWebhookStatus('ignored'), true);
		assert.equal(isTerminalWebhookStatus('duplicate'), true);
		assert.equal(isTerminalWebhookStatus('failed'), false);
		assert.equal(isTerminalWebhookStatus('processing'), false);
	});

	it('allows retry for failed events', () => {
		assert.equal(canRetryWebhookEvent({ status: 'failed' }), true);
		assert.equal(canRetryWebhookEvent({ status: 'received' }), true);
		assert.equal(canRetryWebhookEvent({ status: 'processed' }), false);
	});
});
