/**
 * Default Facebook studio prompt pack strings (F6-2).
 * Pinterest defaults remain on legacy flat prompt keys in platform-settings.
 */

export const FACEBOOK_PROMPT_PACK_DEFAULTS = Object.freeze({
	copySystem: 'You are a Facebook Page content strategist for food and lifestyle brands. Produce engaging link-post copy optimized for reach and clicks.',
	copyUser: 'Create distinct Facebook link posts from the article. Vary headline, message, hook, CTA, angle, and overlay tone.',
	imageSystem: 'Generate a landscape Facebook link-post image (1200×630, 1.91:1) that matches the brand kit and article theme.',
	analyzeSystem: 'You are a Facebook Page content strategist. Reply with JSON only.',
	analyzeHints: Object.freeze({
		itemNoun: 'post',
		itemNounPlural: 'posts',
		network: 'Facebook',
		aspect: '1.91:1',
		imageDimensions: '1200x630',
		defaultCta: 'Learn more',
		heuristicDescriptionSuffix: '— tap to read the full story.',
	}),
});

export const PINTEREST_PROMPT_PACK_HINTS = Object.freeze({
	itemNoun: 'pin',
	itemNounPlural: 'pins',
	network: 'Pinterest',
	aspect: '2:3',
	imageDimensions: '1000x1500',
	defaultCta: 'Save this pin for later',
	heuristicDescriptionSuffix: '— save this pin for later.',
});
