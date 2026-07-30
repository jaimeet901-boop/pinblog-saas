/**
 * Phase 1 guided Website Setup — progress stages + local preferences.
 * Constitution: Setup Mode until first publish; progressive disclosure.
 */

export const SETUP_STAGES = [
	{ id: 'website', label: 'Website Created' },
	{ id: 'wordpress', label: 'Configure WordPress' },
	{ id: 'scan', label: 'Scan Website' },
	{ id: 'articles', label: 'Review Articles' },
	{ id: 'pins', label: 'Generate First AI Pin' },
	{ id: 'pinterest', label: 'Connect Pinterest' },
	{ id: 'publish', label: 'Publish First Pin' },
	{ id: 'analytics', label: 'View Analytics' },
];

const WP_SKIP_PREFIX = 'chefia-setup-wp-skip:';
const ANALYTICS_SEEN_PREFIX = 'chefia-setup-analytics-seen:';
const SETUP_RETURN_KEY = 'chefia-setup-return';

function readFlag(prefix, websiteId) {
	const id = String(websiteId || '').trim();
	if (!id) return false;
	try {
		return localStorage.getItem(`${prefix}${id}`) === '1';
	} catch {
		return false;
	}
}

function writeFlag(prefix, websiteId, value) {
	const id = String(websiteId || '').trim();
	if (!id) return;
	try {
		const key = `${prefix}${id}`;
		if (value) localStorage.setItem(key, '1');
		else localStorage.removeItem(key);
	} catch {
		/* ignore */
	}
}

export function isWordPressSkipped(websiteId) {
	return readFlag(WP_SKIP_PREFIX, websiteId);
}

export function setWordPressSkipped(websiteId, skipped = true) {
	writeFlag(WP_SKIP_PREFIX, websiteId, skipped);
}

export function isAnalyticsSeen(websiteId) {
	return readFlag(ANALYTICS_SEEN_PREFIX, websiteId);
}

export function markAnalyticsSeen(websiteId) {
	writeFlag(ANALYTICS_SEEN_PREFIX, websiteId, true);
}

/** Persist where to return after Pinterest OAuth / connect. */
export function setSetupReturnPath(path) {
	try {
		const next = String(path || '').trim();
		if (next) localStorage.setItem(SETUP_RETURN_KEY, next);
		else localStorage.removeItem(SETUP_RETURN_KEY);
	} catch {
		/* ignore */
	}
}

export function consumeSetupReturnPath() {
	try {
		const next = String(localStorage.getItem(SETUP_RETURN_KEY) || '').trim();
		localStorage.removeItem(SETUP_RETURN_KEY);
		return next;
	} catch {
		return '';
	}
}

export function peekSetupReturnPath() {
	try {
		return String(localStorage.getItem(SETUP_RETURN_KEY) || '').trim();
	} catch {
		return '';
	}
}

/**
 * @param {object} site
 * @param {{ pinterestConnected?: boolean }} [options]
 */
export function deriveWebsiteLifecycle(site = {}, options = {}) {
	const id = String(site.id || '').trim();
	const wordpress = site.control?.wordpress || site.wordpress || {};
	const siteInfo = site.control?.siteInfo || {};
	const stats = site.control?.stats || site.stats || {};
	const performance = site.performance || site.control?.performance || {};
	const dashboard = site.dashboard || {};
	const pinterestConnected = Boolean(options.pinterestConnected);
	const wpSkipped = isWordPressSkipped(id);
	const analyticsSeen = isAnalyticsSeen(id);

	const wpConnected = Boolean(
		wordpress.connection?.status === 'connected'
		|| wordpress.credentials?.status === 'configured'
		|| (site.wp_username && (wordpress.applicationPassword?.status === 'configured' || site.wp_app_password_set)),
	);
	const needsWp = Boolean(wordpress.needsConfiguration) || !wpConnected;
	const wordpressDone = (wpConnected && !needsWp) || wpSkipped;

	const lastScan = siteInfo.lastScan || site.last_scan_at || stats.lastScan || '';
	const hasScan = Boolean(lastScan);
	const articleCount = Number(
		stats.totalArticles
		?? site.totalArticles
		?? dashboard.stats?.totalArticles
		?? 0,
	);
	const hasArticles = articleCount > 0 || String(site.discovery_status || '').toLowerCase() === 'ready';

	const publishedPins = Number(
		stats.publishedPins
		?? performance.totalPublishedPins
		?? dashboard.stats?.publishedPins
		?? 0,
	);
	const pinCount = Number(stats.aiPins ?? dashboard.aiGeneration?.totalPins ?? 0);
	const hasPublished = publishedPins > 0;
	const hasPin = pinCount > 0 || hasPublished;

	const stages = SETUP_STAGES.map((stage) => {
		let done = false;
		switch (stage.id) {
			case 'website':
				done = Boolean(id);
				break;
			case 'wordpress':
				done = wordpressDone;
				break;
			case 'scan':
				done = hasScan;
				break;
			case 'articles':
				done = hasArticles;
				break;
			case 'pins':
				done = hasPin;
				break;
			case 'pinterest':
				done = pinterestConnected || hasPublished;
				break;
			case 'publish':
				done = hasPublished;
				break;
			case 'analytics':
				done = Boolean(analyticsSeen);
				break;
			default:
				done = false;
		}
		return { ...stage, done };
	});

	const checklist = stages;

	let step = 'scan';
	let primaryLabel = 'Open dashboard';
	let primaryHref = id ? `/app/websites/${id}` : '/app/websites';
	let secondaryLabel = '';
	let secondaryAction = '';

	if (!id) {
		step = 'create';
		primaryLabel = 'Add website';
		primaryHref = '/app/websites';
	} else if (!wordpressDone) {
		step = 'wordpress';
		primaryLabel = 'Configure WordPress';
		primaryHref = '/app/websites';
		secondaryLabel = 'Skip for now';
		secondaryAction = 'skip_wordpress';
	} else if (!hasScan || (!hasArticles && hasScan)) {
		step = 'scan';
		primaryLabel = hasScan && !hasArticles ? 'Scan again' : 'Scan website';
		primaryHref = `/app/websites/${id}`;
	} else if (hasArticles && !hasPin) {
		step = 'articles';
		primaryLabel = 'Create AI Pin';
		primaryHref = `/app/ai-pins?websiteId=${encodeURIComponent(id)}`;
		secondaryLabel = 'Review Articles';
		secondaryAction = 'articles';
	} else if (hasPin && !pinterestConnected && !hasPublished) {
		step = 'pinterest';
		primaryLabel = 'Connect Pinterest';
		primaryHref = `/app/pinterest?websiteId=${encodeURIComponent(id)}&setup=1`;
	} else if (!hasPublished) {
		step = 'publish';
		primaryLabel = 'Publish first pin';
		primaryHref = `/app/ai-pins?websiteId=${encodeURIComponent(id)}&setup=publish`;
	} else if (!analyticsSeen) {
		step = 'analytics';
		primaryLabel = 'Open Analytics';
		primaryHref = `/app/analytics?websiteId=${encodeURIComponent(id)}`;
	} else {
		step = 'operate';
		primaryLabel = 'Open dashboard';
		primaryHref = `/app/websites/${id}`;
	}

	const doneCount = stages.filter((s) => s.done).length;
	const mode = hasPublished ? 'operate' : 'setup';

	return {
		mode,
		step,
		primaryLabel,
		primaryHref,
		secondaryLabel,
		secondaryAction,
		checklist,
		stages,
		doneCount,
		totalStages: stages.length,
		wpConnected: wpConnected && !needsWp,
		wpSkipped,
		wordpressDone,
		hasScan,
		hasArticles,
		hasPublished,
		hasPin,
		pinterestConnected,
		analyticsSeen,
		articleCount,
		pinCount,
	};
}

export function setupStepMessage(step) {
	switch (step) {
		case 'create':
			return 'Add your first website to begin.';
		case 'wordpress':
			return 'Connect WordPress so Chef IA can sync content and publish back to your site. You can skip and scan public pages first.';
		case 'scan':
			return 'Scan your website to discover articles for AI Pins.';
		case 'articles':
			return 'Articles are ready — generate your first AI Pin.';
		case 'pins':
			return 'Create your first AI Pin from an article.';
		case 'pinterest':
			return 'Connect Pinterest so you can publish your pin.';
		case 'publish':
			return 'Publish your first pin to complete setup.';
		case 'analytics':
			return 'First pin published — open Analytics to measure performance.';
		case 'operate':
			return 'Setup complete. Your website is ready for ongoing production.';
		default:
			return 'Continue setup for this website.';
	}
}

export function setupStepWhy(step) {
	switch (step) {
		case 'wordpress':
			return 'WordPress unlocks reliable sync and optional publishing back to your blog. Scanning without it still works for public URLs.';
		case 'scan':
			return 'A scan finds the articles Chef IA will turn into Pinterest pins.';
		case 'articles':
			return 'Pins need a source article. Generate your first pin from one of these.';
		case 'pinterest':
			return 'Publishing requires a connected Pinterest account and board.';
		case 'publish':
			return 'Your first published pin moves this website into Operate Mode.';
		case 'analytics':
			return 'Analytics shows impressions, saves, and clicks for pins from this website.';
		default:
			return '';
	}
}
