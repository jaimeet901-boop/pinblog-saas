import { describe, expect, it } from 'vitest';
import { normalizeWebsiteList } from './normalizeWebsiteList';

describe('normalizeWebsiteList', () => {
	it('dedupes by id and drops article-shaped rows', () => {
		const rows = [
			{ id: 'w1', domain: 'a.com', name: 'A' },
			{ id: 'w1', domain: 'a.com', name: 'A-dup' },
			{ id: 'art1', title: 'Post', websiteId: 'w1' },
			{ id: 'w2', url: 'https://b.com' },
		];
		expect(normalizeWebsiteList(rows).map((row) => row.id)).toEqual(['w1', 'w2']);
	});

	it('accepts { items } payloads', () => {
		expect(normalizeWebsiteList({ items: [{ id: 'w1', domain: 'a.com' }] })).toHaveLength(1);
	});
});
