/**
 * Brand Kit bridge — reserved for future binding.
 * No-op today; keeps compositor free of PocketBase.
 */

/**
 * @param {object} context
 * @param {object|null} brandKit
 * @returns {object}
 */
export function mergeBrandKitIntoVariableContext(context = {}, brandKit = null) {
	if (!brandKit || typeof brandKit !== 'object') {
		return { ...context };
	}
	const next = { ...context };
	if (!next.logo && !next.logoUrl) {
		const logo = brandKit.logo_url || brandKit.logoUrl || brandKit.logo;
		if (logo) {
			next.logo = String(logo);
			next.logoUrl = String(logo);
		}
	}
	// Future: fonts, colors, watermark theme tokens
	return next;
}
