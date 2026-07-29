import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ ok: true }) });

vi.mock('@/lib/apiServerClient', () => ({
	default: { fetch: (...args) => fetchMock(...args) },
	getActiveWorkspaceId: () => 'ws_test',
}));

import {
	PRODUCT_EVENTS,
	_resetProductEventDedupeForTests,
	buildTemplateEventProps,
	trackProductEvent,
} from '../productAnalytics.js';

describe('productAnalytics', () => {
	beforeEach(() => {
		fetchMock.mockClear();
		_resetProductEventDedupeForTests();
	});

	it('posts funnel events without throwing', () => {
		trackProductEvent(PRODUCT_EVENTS.TEMPLATE_GALLERY_VIEW, {
			sourcePage: 'templates_gallery',
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, options] = fetchMock.mock.calls[0];
		expect(url).toBe('/workspace/v1/product-events');
		expect(options.method).toBe('POST');
		const body = JSON.parse(options.body);
		expect(body.event).toBe('template_gallery_view');
		expect(body.workspaceId).toBe('ws_test');
		expect(body.sourcePage).toBe('templates_gallery');
		expect(body.timestamp).toBeTruthy();
	});

	it('dedupes identical events within the TTL window', () => {
		trackProductEvent(PRODUCT_EVENTS.TEMPLATE_PREVIEW_OPEN, {
			templateId: 't1',
			sourcePage: 'templates_gallery',
		});
		trackProductEvent(PRODUCT_EVENTS.TEMPLATE_PREVIEW_OPEN, {
			templateId: 't1',
			sourcePage: 'templates_gallery',
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('never throws when the network fails', () => {
		fetchMock.mockRejectedValueOnce(new Error('network down'));
		expect(() => {
			trackProductEvent(PRODUCT_EVENTS.UPGRADE_BUTTON_CLICK, {
				templateId: 't2',
				sourcePage: 'upgrade_modal',
			}, { dedupe: false });
		}).not.toThrow();
	});

	it('builds props from template access without inferring lock state', () => {
		const props = buildTemplateEventProps({
			id: 'tpl_1',
			name: 'Hero',
			premium: true,
			requiredFeatureKeys: ['templates.premium'],
			access: {
				visible: true,
				enabled: false,
				locked: true,
				missingKeys: ['templates.premium'],
				dependencyChain: ['templates.premium'],
			},
		}, { sourcePage: 'ai_pins_chooser' });
		expect(props.templateId).toBe('tpl_1');
		expect(props.missingKeys).toEqual(['templates.premium']);
		expect(props.requiredFeatureKeys).toEqual(['templates.premium']);
		expect(props.sourcePage).toBe('ai_pins_chooser');
	});
});
