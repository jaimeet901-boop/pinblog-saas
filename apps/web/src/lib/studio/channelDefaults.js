/**
 * Default Facebook studio prompt pack strings (F6-2).
 * Pinterest defaults remain on legacy flat prompt keys in workspace config.
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

export const DEFAULT_FLAT_PROMPTS = Object.freeze({
	pinSystem: 'You are a Pinterest growth strategist for food and lifestyle brands. Produce unique, high-CTR pin copy.',
	pinUser: 'Create distinct Pinterest pins from the article. Vary title, description, hook, CTA, angle, and overlay tone.',
	writerSystem: 'You are an expert SEO content writer for recipe and lifestyle blogs.',
	imageSystem: 'Generate a vertical Pinterest-ready image that matches the brand kit and article theme.',
});
