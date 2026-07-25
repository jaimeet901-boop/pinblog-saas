import { describe, expect, it } from 'vitest';
import {
	LAYER_TYPES,
	RENDER_TARGETS,
	TEMPLATE_CATEGORIES,
	TEMPLATE_STATUS,
	TEMPLATE_VISIBILITY,
} from '../pinEngineConstants.js';

describe('Module 8 constants integrity', () => {
	it('keeps registry enums non-empty and stable', () => {
		expect(LAYER_TYPES.length).toBeGreaterThan(5);
		expect(LAYER_TYPES).toContain('text');
		expect(LAYER_TYPES).toContain('aiImage');
		expect(RENDER_TARGETS).toEqual(expect.arrayContaining(['png', 'jpg', 'svg', 'mp4']));
		expect(TEMPLATE_CATEGORIES).toContain('recipes');
		expect(TEMPLATE_STATUS).toEqual(expect.arrayContaining(['draft', 'published', 'archived']));
		expect(TEMPLATE_VISIBILITY).toContain('workspace');
	});
});
