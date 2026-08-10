/**
 * Facebook-only background fit policy for canvas compose (Phase D).
 * Pinterest continues to use drawCoverImage() — do not use this module there.
 */

export const FACEBOOK_EXPORT_PROFILE_IDS = Object.freeze(['facebook_post', 'facebook_story']);

/** Relative aspect-ratio tolerance for treating source as matching target (2%). */
export const DEFAULT_FACEBOOK_ASPECT_TOLERANCE = 0.02;

export const DEFAULT_FACEBOOK_LETTERBOX_COLOR = '#111111';

/**
 * @param {string} exportProfileId
 * @returns {boolean}
 */
export function isFacebookExportProfile(exportProfileId) {
	const id = String(exportProfileId || '').trim().toLowerCase();
	return id === 'facebook_post' || id === 'facebook_story';
}

/**
 * Compute uniform-scale placement for a Facebook background image.
 *
 * - Matching aspect (within tolerance): fill canvas exactly — no crop, no distortion.
 * - Material mismatch: contain + centered letterbox — full image visible, no stretch.
 *
 * @param {{
 *   sourceWidth: number,
 *   sourceHeight: number,
 *   targetWidth: number,
 *   targetHeight: number,
 *   tolerance?: number,
 * }} params
 * @returns {{
 *   mode: 'fill' | 'contain',
 *   x: number,
 *   y: number,
 *   drawW: number,
 *   drawH: number,
 *   aspectMatched: boolean,
 *   sourceAspect: number,
 *   targetAspect: number,
 * }}
 */
export function resolveFacebookBackgroundPlacement({
	sourceWidth,
	sourceHeight,
	targetWidth,
	targetHeight,
	tolerance = DEFAULT_FACEBOOK_ASPECT_TOLERANCE,
}) {
	const iw = Number(sourceWidth) || 0;
	const ih = Number(sourceHeight) || 0;
	const tw = Number(targetWidth) || 0;
	const th = Number(targetHeight) || 0;
	if (!iw || !ih || !tw || !th) {
		throw new Error('Facebook background fit requires non-zero source and target dimensions');
	}

	const sourceAspect = iw / ih;
	const targetAspect = tw / th;
	const relativeDiff = Math.abs(sourceAspect - targetAspect) / targetAspect;
	const aspectMatched = relativeDiff <= tolerance;

	if (aspectMatched) {
		return {
			mode: 'fill',
			x: 0,
			y: 0,
			drawW: tw,
			drawH: th,
			aspectMatched: true,
			sourceAspect,
			targetAspect,
		};
	}

	const scale = Math.min(tw / iw, th / ih);
	const drawW = iw * scale;
	const drawH = ih * scale;
	return {
		mode: 'contain',
		x: (tw - drawW) / 2,
		y: (th - drawH) / 2,
		drawW,
		drawH,
		aspectMatched: false,
		sourceAspect,
		targetAspect,
	};
}

/**
 * Draw a Facebook background on a Canvas 2D context (v1 procedural renderer).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} img
 * @param {number} width
 * @param {number} height
 * @param {{ backgroundColor?: string, tolerance?: number }} [options]
 * @returns {ReturnType<typeof resolveFacebookBackgroundPlacement>}
 */
export function drawFacebookBackground(ctx, img, width, height, {
	backgroundColor = DEFAULT_FACEBOOK_LETTERBOX_COLOR,
	tolerance = DEFAULT_FACEBOOK_ASPECT_TOLERANCE,
} = {}) {
	const iw = Number(img.naturalWidth || img.width) || 0;
	const ih = Number(img.naturalHeight || img.height) || 0;
	if (!iw || !ih) {
		throw new Error('Cannot draw Facebook background with empty dimensions');
	}

	const placement = resolveFacebookBackgroundPlacement({
		sourceWidth: iw,
		sourceHeight: ih,
		targetWidth: width,
		targetHeight: height,
		tolerance,
	});

	ctx.fillStyle = backgroundColor;
	ctx.fillRect(0, 0, width, height);
	ctx.drawImage(img, placement.x, placement.y, placement.drawW, placement.drawH);
	return placement;
}

/**
 * Draw a Facebook background on a compositor RenderSurface (v2 layer path).
 *
 * @param {{ fillRect: Function, drawImage: Function }} surface
 * @param {CanvasImageSource} img
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {{ backgroundColor?: string, tolerance?: number }} [options]
 * @returns {ReturnType<typeof resolveFacebookBackgroundPlacement>}
 */
export function drawFacebookBackgroundOnSurface(surface, img, x, y, width, height, {
	backgroundColor = DEFAULT_FACEBOOK_LETTERBOX_COLOR,
	tolerance = DEFAULT_FACEBOOK_ASPECT_TOLERANCE,
} = {}) {
	const iw = Number(img.width || img.naturalWidth) || 0;
	const ih = Number(img.height || img.naturalHeight) || 0;
	if (!iw || !ih) {
		throw new Error('Cannot draw Facebook background with empty dimensions');
	}

	const placement = resolveFacebookBackgroundPlacement({
		sourceWidth: iw,
		sourceHeight: ih,
		targetWidth: width,
		targetHeight: height,
		tolerance,
	});

	surface.fillRect(x, y, width, height, backgroundColor);
	surface.drawImage(img, x + placement.x, y + placement.y, placement.drawW, placement.drawH);
	return placement;
}
