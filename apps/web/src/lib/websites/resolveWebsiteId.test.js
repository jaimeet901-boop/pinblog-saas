import { describe, expect, it } from 'vitest';
import { resolveWebsiteId } from './resolveWebsiteId';

describe('resolveWebsiteId', () => {
	it('keeps previous id when it exists in the loaded list', () => {
		const websites = [{ id: 'a' }, { id: 'b' }];
		expect(resolveWebsiteId('b', websites)).toBe('b');
	});

	it('falls back to first website when previous id is missing', () => {
		const websites = [{ id: 'a' }, { id: 'b' }];
		expect(resolveWebsiteId('c', websites)).toBe('a');
	});

	it('returns empty string when websites list is empty', () => {
		expect(resolveWebsiteId('a', [])).toBe('');
		expect(resolveWebsiteId('a', null)).toBe('');
	});
});
