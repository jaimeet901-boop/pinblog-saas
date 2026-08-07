import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	extractRecordChannel,
	matchesChannelFilter,
	normalizeTemplateChannel,
	TEMPLATE_CHANNELS,
} from '../constants/template-channels.js';

describe('template-channels', () => {
	it('exports known platform channels', () => {
		assert.deepEqual(TEMPLATE_CHANNELS, [
			'pinterest',
			'facebook',
			'instagram',
			'linkedin',
			'twitter',
		]);
	});

	it('normalizeTemplateChannel accepts known channels only', () => {
		assert.equal(normalizeTemplateChannel('pinterest'), 'pinterest');
		assert.equal(normalizeTemplateChannel('Facebook'), 'facebook');
		assert.equal(normalizeTemplateChannel('unknown'), '');
		assert.equal(normalizeTemplateChannel(''), '');
	});

	it('extractRecordChannel prefers marketplace_meta.channel', () => {
		assert.equal(extractRecordChannel({
			marketplace_meta: { channel: 'facebook' },
			configuration: { canvas: { width: 1000, height: 1500 } },
		}), 'facebook');
	});

	it('extractRecordChannel prefers marketplace_meta.pack when channel absent', () => {
		assert.equal(extractRecordChannel({
			marketplace_meta: { pack: 'pinterest' },
		}), 'pinterest');
	});

	it('extractRecordChannel uses tag fallback before canvas heuristic', () => {
		assert.equal(extractRecordChannel({
			marketplace_meta: { tags: ['facebook', 'link-post'] },
			configuration: { canvas: { width: 1000, height: 1500 } },
		}), 'facebook');
	});

	it('extractRecordChannel uses canvas heuristic only for legacy rows', () => {
		assert.equal(extractRecordChannel({
			configuration: { canvas: { width: 1200, height: 630 } },
		}), 'facebook');
		assert.equal(extractRecordChannel({
			configuration: { canvas: { width: 1000, height: 1500 } },
		}), 'pinterest');
	});

	it('matchesChannelFilter scopes records by channel', () => {
		const pinterest = { marketplace_meta: { channel: 'pinterest' } };
		const facebook = { marketplace_meta: { channel: 'facebook' } };
		assert.equal(matchesChannelFilter(pinterest, 'pinterest'), true);
		assert.equal(matchesChannelFilter(pinterest, 'facebook'), false);
		assert.equal(matchesChannelFilter(facebook, 'facebook'), true);
	});
});
