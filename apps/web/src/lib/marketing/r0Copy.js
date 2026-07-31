/**
 * R0 locked marketing copy — do not rewrite product positioning here.
 * Consumed by Landing + AuthShell (R1 UI only).
 */

export const R0_POSITION =
	'AI Content & Multi-channel Publishing Platform';

export const R0_WORKFLOW = Object.freeze([
	'Create',
	'Brand',
	'Connect',
	'Schedule',
	'Measure',
]);

export const R0_HERO = Object.freeze({
	headline: 'Create content once. Publish across your channels.',
	subheadline:
		'Chef IA is an AI content and multi-channel publishing platform. Write SEO articles, design branded creatives, connect your sites and social accounts, then schedule and measure from one workspace.',
	primaryCta: 'Start free workspace',
	secondaryCta: 'Sign in',
});

export const R0_INTRO =
	'Chef IA brings creation, branding, channel connections, scheduling, and analytics into a single workspace. Start from your websites, generate articles and images with AI, publish through connected channels, and keep everything visible in one calendar — without rebuilding your workflow when you add the next channel.';

export const R0_FEATURE_GROUPS = Object.freeze([
	{
		id: 'ai-creation',
		title: 'AI Creation',
		items: [
			{
				id: 'ai-writer',
				title: 'AI Writer',
				desc: 'Generate SEO-ready articles with titles, structure, and on-page essentials for your websites.',
			},
			{
				id: 'ai-image-studio',
				title: 'AI Image Studio',
				desc: 'Create branded visuals in the formats your channels need — ready for templates and publishing.',
			},
		],
	},
	{
		id: 'brand',
		title: 'Brand Management',
		items: [
			{
				id: 'brand-kit',
				title: 'Brand Kit',
				desc: 'Keep colors, fonts, and brand assets consistent across every generation and destination.',
			},
		],
	},
	{
		id: 'channels',
		title: 'Social Channels',
		items: [
			{
				id: 'pinterest-hub',
				title: 'Pinterest Hub',
				desc: 'Connect Pinterest accounts and boards, sync destinations, and manage publish-ready links.',
			},
			{
				id: 'facebook-hub',
				title: 'Facebook Hub',
				desc: 'Connect Facebook accounts and Pages, sync destinations, and keep channel health visible.',
			},
			{
				id: 'wordpress',
				title: 'WordPress Integration',
				desc: 'Connect WordPress sites so articles can move from draft to publish in your existing CMS.',
			},
		],
	},
	{
		id: 'publishing',
		title: 'Publishing',
		items: [
			{
				id: 'publishing-center',
				title: 'Publishing Center',
				desc: 'Track publish activity across connected destinations from one history surface.',
			},
			{
				id: 'unified-calendar',
				title: 'Unified Calendar',
				desc: 'See scheduled and published work across websites and channels in one calendar view.',
			},
		],
	},
	{
		id: 'analytics',
		title: 'Analytics',
		items: [
			{
				id: 'analytics',
				title: 'Analytics',
				desc: 'Monitor creation and publishing activity over time so you know what your workspace ships.',
			},
		],
	},
	{
		id: 'workspaces',
		title: 'Workspaces',
		items: [
			{
				id: 'workspaces',
				title: 'Workspaces',
				desc: 'Organize websites, channels, and publishing in a secure workspace built for growing teams.',
			},
			{
				id: 'multi-website',
				title: 'Multi-website support',
				desc: 'Run multiple sites from one account without splitting your content operations.',
			},
		],
	},
]);

export const R0_ONBOARDING = Object.freeze([
	{
		title: 'Create your workspace',
		desc: 'Set up the place where sites, content, and channels live together.',
	},
	{
		title: 'Add a website',
		desc: 'Connect the site that anchors your content and publishing.',
	},
	{
		title: 'Connect destinations',
		desc: 'Link WordPress and the social channels you use today.',
	},
	{
		title: 'Create with AI',
		desc: 'Generate articles and branded visuals in your content studios.',
	},
	{
		title: 'Schedule and publish',
		desc: 'Plan in the Unified Calendar and ship through your connected channels.',
	},
]);

export const R0_BENEFITS = Object.freeze([
	{
		title: 'Ship more with less switching',
		desc: 'Write, design, connect, and schedule in one workspace instead of scattered tools.',
	},
	{
		title: 'AI that serves the full pipeline',
		desc: 'Generation is built for publishing — not a detached chat window.',
	},
	{
		title: 'Multi-channel by design',
		desc: 'Add channels as you grow. The workflow stays create → brand → connect → schedule → measure.',
	},
	{
		title: 'Website-centric operations',
		desc: 'Keep multi-site content organized without losing channel context.',
	},
]);

export const R0_FOOTER = Object.freeze({
	tagline: 'Chef IA — AI content and multi-channel publishing.',
	note: 'Create once. Publish across your channels.',
});

export const R0_SEO = Object.freeze({
	metaTitle: 'Chef IA — AI Content & Multi-channel Publishing Platform',
	metaDescription:
		'Chef IA helps teams create SEO articles and branded visuals, connect websites and social channels, then schedule and publish from one workspace.',
	ogDescription:
		'AI content creation and multi-channel publishing for modern websites — write, design, connect channels, schedule, and measure in Chef IA.',
});

/** Official social share image (served from /og-chef-ia.png). */
export const R0_OG_IMAGE_PATH = '/og-chef-ia.png';

/**
 * Page-specific SEO for public marketing/auth routes.
 * Copy inherits R0 positioning; titles differ per page.
 */
export const R0_PAGE_SEO = Object.freeze({
	landing: Object.freeze({
		path: '/',
		metaTitle: R0_SEO.metaTitle,
		browserTitle: R0_SEO.metaTitle,
		metaDescription: R0_SEO.metaDescription,
		ogTitle: R0_SEO.metaTitle,
		ogDescription: R0_SEO.ogDescription,
		twitterTitle: R0_SEO.metaTitle,
		twitterDescription: R0_SEO.ogDescription,
	}),
	login: Object.freeze({
		path: '/login',
		metaTitle: 'Sign in — Chef IA',
		browserTitle: 'Sign in — Chef IA',
		metaDescription:
			'Sign in to your Chef IA workspace to create content, connect channels, and schedule publishing.',
		ogTitle: 'Sign in — Chef IA',
		ogDescription: R0_SEO.ogDescription,
		twitterTitle: 'Sign in — Chef IA',
		twitterDescription: R0_SEO.ogDescription,
	}),
	signup: Object.freeze({
		path: '/signup',
		metaTitle: 'Create your workspace — Chef IA',
		browserTitle: 'Create your workspace — Chef IA',
		metaDescription:
			'Start a free Chef IA workspace to write with AI, brand creatives, connect destinations, and publish across channels.',
		ogTitle: 'Create your workspace — Chef IA',
		ogDescription: R0_SEO.ogDescription,
		twitterTitle: 'Create your workspace — Chef IA',
		twitterDescription: R0_SEO.ogDescription,
	}),
});

export const R0_AUTH = Object.freeze({
	loginSubtitle: 'Sign in to your Chef IA workspace.',
	signupSubtitle: 'Start creating content and publishing across your channels.',
	eyebrow: 'Chef IA',
});

/** Live destinations today + reserved slots for future channels (UI-only). */
export const R0_CHANNELS = Object.freeze({
	live: [
		{ id: 'wordpress', label: 'WordPress', status: 'live' },
		{ id: 'pinterest', label: 'Pinterest', status: 'live' },
		{ id: 'facebook', label: 'Facebook', status: 'live' },
	],
	soon: [
		{ id: 'instagram', label: 'Instagram', status: 'soon' },
		{ id: 'linkedin', label: 'LinkedIn', status: 'soon' },
		{ id: 'x', label: 'X', status: 'soon' },
		{ id: 'threads', label: 'Threads', status: 'soon' },
		{ id: 'tiktok', label: 'TikTok', status: 'soon' },
		{ id: 'youtube', label: 'YouTube', status: 'soon' },
		{ id: 'bluesky', label: 'Bluesky', status: 'soon' },
	],
});
