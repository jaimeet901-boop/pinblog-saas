import { describe, expect, it } from 'vitest';
import {
	composeDocument,
	createMockRenderSurface,
} from '../pinLayerCompositor.js';
import { normalizeEditorDocument } from '../pinLayerSchema.js';
import {
	DEFAULT_FACEBOOK_ASPECT_TOLERANCE,
	drawFacebookBackground,
	isFacebookExportProfile,
	resolveFacebookBackgroundPlacement,
} from '../facebookBackgroundFit.js';

describe('isFacebookExportProfile', () => {
	it('recognizes facebook export profiles only', () => {
		expect(isFacebookExportProfile('facebook_post')).toBe(true);
		expect(isFacebookExportProfile('facebook_story')).toBe(true);
		expect(isFacebookExportProfile('pinterest_standard')).toBe(false);
		expect(isFacebookExportProfile('')).toBe(false);
	});
});

describe('resolveFacebookBackgroundPlacement', () => {
	it('uses fill mode for exact facebook_post ratio (Fal 1200x630)', () => {
		const placement = resolveFacebookBackgroundPlacement({
			sourceWidth: 1200,
			sourceHeight: 630,
			targetWidth: 1200,
			targetHeight: 630,
		});

		expect(placement.mode).toBe('fill');
		expect(placement.aspectMatched).toBe(true);
		expect(placement.x).toBe(0);
		expect(placement.y).toBe(0);
		expect(placement.drawW).toBe(1200);
		expect(placement.drawH).toBe(630);
	});

	it('uses fill mode for exact facebook_story ratio (Fal 1080x1920)', () => {
		const placement = resolveFacebookBackgroundPlacement({
			sourceWidth: 1080,
			sourceHeight: 1920,
			targetWidth: 1080,
			targetHeight: 1920,
		});

		expect(placement.mode).toBe('fill');
		expect(placement.aspectMatched).toBe(true);
		expect(placement.drawW).toBe(1080);
		expect(placement.drawH).toBe(1920);
	});

	it('uses contain for OpenAI facebook_post 1536x1024 without stretching', () => {
		const placement = resolveFacebookBackgroundPlacement({
			sourceWidth: 1536,
			sourceHeight: 1024,
			targetWidth: 1200,
			targetHeight: 630,
		});

		expect(placement.mode).toBe('contain');
		expect(placement.aspectMatched).toBe(false);
		expect(placement.drawH).toBe(630);
		expect(placement.drawW).toBeCloseTo(945, 0);
		expect(placement.x).toBeGreaterThan(0);
		expect(placement.y).toBe(0);
		const scaleX = placement.drawW / 1536;
		const scaleY = placement.drawH / 1024;
		expect(scaleX).toBeCloseTo(scaleY, 5);
	});

	it('uses contain for Gemini-like 16:9 on facebook_post', () => {
		const placement = resolveFacebookBackgroundPlacement({
			sourceWidth: 1344,
			sourceHeight: 756,
			targetWidth: 1200,
			targetHeight: 630,
		});

		expect(placement.mode).toBe('contain');
		expect(placement.aspectMatched).toBe(false);
		expect(placement.drawW).toBeLessThanOrEqual(1200);
		expect(placement.drawH).toBeLessThanOrEqual(630);
	});

	it('uses contain for OpenAI facebook_story 1024x1536', () => {
		const placement = resolveFacebookBackgroundPlacement({
			sourceWidth: 1024,
			sourceHeight: 1536,
			targetWidth: 1080,
			targetHeight: 1920,
		});

		expect(placement.mode).toBe('contain');
		expect(placement.drawW).toBe(1080);
		expect(placement.drawH).toBeCloseTo(1620, 0);
		expect(placement.y).toBeGreaterThan(0);
	});

	it('uses contain for portrait source on facebook_post landscape canvas', () => {
		const placement = resolveFacebookBackgroundPlacement({
			sourceWidth: 1080,
			sourceHeight: 1920,
			targetWidth: 1200,
			targetHeight: 630,
		});

		expect(placement.mode).toBe('contain');
		expect(placement.drawW).toBeLessThan(1200);
		expect(placement.drawH).toBeLessThanOrEqual(630);
		expect(placement.x).toBeGreaterThan(0);
		expect(placement.y).toBeGreaterThanOrEqual(0);
	});

	it('uses contain for landscape source on facebook_story portrait canvas', () => {
		const placement = resolveFacebookBackgroundPlacement({
			sourceWidth: 1536,
			sourceHeight: 1024,
			targetWidth: 1080,
			targetHeight: 1920,
		});

		expect(placement.mode).toBe('contain');
		expect(placement.drawW).toBeLessThanOrEqual(1080);
		expect(placement.drawH).toBeLessThan(1920);
		expect(placement.y).toBeGreaterThan(0);
	});

	it('treats near-exact ratios within tolerance as fill', () => {
		const placement = resolveFacebookBackgroundPlacement({
			sourceWidth: 1206,
			sourceHeight: 630,
			targetWidth: 1200,
			targetHeight: 630,
			tolerance: DEFAULT_FACEBOOK_ASPECT_TOLERANCE,
		});

		expect(placement.mode).toBe('fill');
		expect(placement.aspectMatched).toBe(true);
	});
});

describe('drawFacebookBackground', () => {
	it('draws full canvas without crop for exact ratio', () => {
		const calls = [];
		const ctx = {
			fillStyle: '',
			fillRect: (...args) => calls.push(['fillRect', ...args]),
			drawImage: (...args) => calls.push(['drawImage', ...args]),
		};
		const img = { naturalWidth: 1200, naturalHeight: 630 };

		const placement = drawFacebookBackground(ctx, img, 1200, 630);

		expect(placement.mode).toBe('fill');
		expect(calls).toContainEqual(['fillRect', 0, 0, 1200, 630]);
		expect(calls).toContainEqual(['drawImage', img, 0, 0, 1200, 630]);
	});

	it('letterboxes approximate ratios instead of stretching', () => {
		const calls = [];
		const ctx = {
			fillStyle: '',
			fillRect: (...args) => calls.push(['fillRect', ...args]),
			drawImage: (...args) => calls.push(['drawImage', ...args]),
		};
		const img = { naturalWidth: 1536, naturalHeight: 1024 };

		const placement = drawFacebookBackground(ctx, img, 1200, 630);

		expect(placement.mode).toBe('contain');
		const drawCall = calls.find((item) => item[0] === 'drawImage');
		expect(drawCall[1]).toBe(img);
		expect(drawCall[4]).toBeCloseTo(945, 0);
		expect(drawCall[5]).toBe(630);
		expect(drawCall[2]).toBeGreaterThan(0);
		expect(drawCall[4]).not.toBe(1200);
	});
});

describe('pinLayerCompositor Facebook v2 background policy', () => {
	it('routes facebook_post backgrounds through facebook fit helper', async () => {
		const surface = createMockRenderSurface(1200, 630);
		const doc = normalizeEditorDocument({
			editorVersion: 2,
			canvas: { width: 1200, height: 630 },
			layers: [{
				type: 'background',
				zIndex: 0,
				width: 1200,
				height: 630,
				props: { color: '#111111', imageSrc: 'https://cdn.example/bg.png' },
			}],
		});
		await composeDocument(doc, surface, {
			exportProfileId: 'facebook_post',
			loadImageFn: async () => ({ width: 1536, height: 1024 }),
		});

		expect(surface.ops.some((item) => item.op === 'fillRect')).toBe(true);
		expect(surface.ops.some((item) => item.op === 'drawImage')).toBe(true);
	});

	it('keeps pinterest backgrounds on the legacy cover path', async () => {
		const surface = createMockRenderSurface(1000, 1500);
		const doc = normalizeEditorDocument({
			editorVersion: 2,
			canvas: { width: 1000, height: 1500 },
			layers: [{
				type: 'background',
				zIndex: 0,
				width: 1000,
				height: 1500,
				props: { color: '#111111', imageSrc: 'https://cdn.example/bg.png' },
			}],
		});
		await composeDocument(doc, surface, {
			exportProfileId: 'pinterest_standard',
			loadImageFn: async () => ({ width: 1024, height: 1536 }),
		});

		expect(surface.ops.filter((item) => item.op === 'fillRect').length).toBeGreaterThanOrEqual(1);
		expect(surface.ops.some((item) => item.op === 'drawImage')).toBe(true);
	});
});

describe('Pinterest compose contract', () => {
	it('does not classify pinterest profiles as Facebook', () => {
		expect(isFacebookExportProfile('pinterest_standard')).toBe(false);
		expect(isFacebookExportProfile('pinterest_long')).toBe(false);
	});
});
