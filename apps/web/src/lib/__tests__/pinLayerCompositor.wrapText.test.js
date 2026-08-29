import { describe, expect, it } from 'vitest';
import { wrapText } from '../pinLayerCompositor.js';

function mockSurface(charWidth = 8) {
	return {
		measureText(text) {
			return String(text || '').length * charWidth;
		},
	};
}

describe('v2 wrapText newline-aware wrapping', () => {
	it('preserves explicit newline hard breaks', () => {
		const lines = wrapText(
			mockSurface(),
			'ingredient 1\ningredient 2\ningredient 3',
			'16px sans-serif',
			400,
			10,
		);
		expect(lines).toEqual(['ingredient 1', 'ingredient 2', 'ingredient 3']);
	});

	it('still wraps a long individual ingredient line', () => {
		const long = 'one two three four five six seven eight nine ten';
		const lines = wrapText(mockSurface(10), long, '16px sans-serif', 50, 10);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.join(' ')).toBe(long);
	});

	it('respects maxLines truncation with newline input', () => {
		const lines = wrapText(
			mockSurface(),
			'a\nb\nc\nd\ne',
			'16px sans-serif',
			400,
			3,
		);
		expect(lines).toEqual(['a', 'b', 'c']);
	});

	it('handles empty text without throwing', () => {
		expect(wrapText(mockSurface(), '', '16px sans-serif', 400, 4)).toEqual([]);
		expect(wrapText(mockSurface(), null, '16px sans-serif', 400, 4)).toEqual([]);
	});
});
