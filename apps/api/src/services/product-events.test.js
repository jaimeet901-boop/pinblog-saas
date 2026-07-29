import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildTrustedProductEvent,
	isKnownProductEvent,
	PRODUCT_EVENT_NAMES,
} from './product-events.js';

describe('product-events catalog', () => {
	it('includes the Premium Template funnel events', () => {
		const required = [
			'template_gallery_view',
			'template_preview_open',
			'template_locked_click',
			'upgrade_modal_open',
			'upgrade_button_click',
			'subscription_page_open',
			'template_used',
			'template_generated',
		];
		for (const name of required) {
			assert.equal(isKnownProductEvent(name), true);
			assert.ok(PRODUCT_EVENT_NAMES.includes(name));
		}
	});

	it('rejects unknown events', () => {
		assert.equal(isKnownProductEvent('not_a_real_event'), false);
	});

	it('buildTrustedProductEvent ignores spoofed workspace/plan', () => {
		const built = buildTrustedProductEvent(
			{ workspace: { id: 'real', plan_slug: 'free' }, workspaceKey: 'real_key' },
			{
				event: 'template_locked_click',
				workspaceId: 'spoof',
				currentPlan: 'business',
			},
		);
		assert.equal(built.metadata.workspaceId, 'real');
		assert.equal(built.metadata.currentPlan, 'free');
	});
});
