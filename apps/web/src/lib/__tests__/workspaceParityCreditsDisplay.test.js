/**
 * WS-07 customer-facing credit display honesty.
 * Run: node --test src/lib/__tests__/workspaceParityCreditsDisplay.test.js
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, '../..');

function readSrc(relativePath) {
	return readFileSync(path.join(webSrc, relativePath), 'utf8');
}

describe('WS-07 Settings remaining wording', () => {
	it('shows Credits remaining: N and contains no ~N/mo wording', () => {
		const settings = readSrc('pages/app/SettingsPage.jsx');
		assert.match(settings, /Credits remaining: \{creditsRemaining\}/);
		assert.match(settings, /Included plan credits\/month/);
		assert.doesNotMatch(settings, /~\{creditsRemaining\}\/mo/);
		assert.doesNotMatch(settings, /~\$\{creditsRemaining\}\/mo/);
		assert.doesNotMatch(settings, /~\{[^}]*\}\/mo/);
	});
});

describe('WS-07 Dashboard + Subscription wallet vs plan allowance', () => {
	it('dashboard remaining 12 is not presented as 88 used', () => {
		const dashboard = readSrc('pages/app/DashboardPage.jsx');
		assert.match(dashboard, /workspaceWalletRemaining\(credits\)/);
		assert.match(dashboard, /Credits remaining: \{creditsRemaining\}/);
		assert.match(dashboard, /Included plan credits\/month/);
		assert.doesNotMatch(dashboard, /quota - /);
		assert.doesNotMatch(dashboard, /credits\.used \|\|/);
		assert.doesNotMatch(dashboard, /\$\{used\}\/\$\{quota\} used/);
	});

	it('subscription remaining does not fall back to quota - used', () => {
		const subscription = readSrc('pages/app/SubscriptionPage.jsx');
		assert.match(subscription, /workspaceWalletRemaining\(credits\)/);
		assert.match(subscription, /Credits remaining/);
		assert.match(subscription, /Included plan credits\/month/);
		assert.doesNotMatch(subscription, /Math\.max\(0, quota - creditsUsed\)/);
		assert.doesNotMatch(subscription, /credits\.used \|\| usage\.monthArticles/);
		assert.doesNotMatch(subscription, /label: 'Credits Used'/);
	});

	it('removes synthetic subscription usage charts', () => {
		const subscription = readSrc('pages/app/SubscriptionPage.jsx');
		assert.doesNotMatch(subscription, /AreaChart/);
		assert.doesNotMatch(subscription, /creditsUsed \* \(\(7 - i\) \/ 7\)/);
		assert.doesNotMatch(subscription, /name: 'Other AI'/);
		assert.doesNotMatch(subscription, /Sample charts/);
		assert.match(subscription, /Usage charts are unavailable/);
	});
});

describe('WS-07 AI Pins + AI Facebook shared workspace credits', () => {
	it('Pinterest and Facebook studio show the same workspace remaining', () => {
		const pins = readSrc('pages/app/AIPinsPage.jsx');
		const facebook = readSrc('pages/app/AIFacebookPagesPage.jsx');
		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		const mapper = readSrc('lib/aiPinsWorkspaceConfig.js');

		assert.match(pins, /ContentStudioPage/);
		assert.match(facebook, /ContentStudioPage/);
		assert.match(studio, /mapStudioCredits\(config\)/);
		assert.match(studio, /Workspace credits/);
		assert.match(studio, /credits\.remaining/);
		assert.doesNotMatch(studio, /AI remaining/);
		assert.doesNotMatch(studio, /Img remaining/);
		assert.doesNotMatch(studio, /credits\.ai\?\.remaining/);
		assert.doesNotMatch(studio, /credits\.image\?\.remaining/);
		assert.match(mapper, /workspaceWalletRemaining/);
		assert.match(mapper, /export function mapStudioCredits/);
		assert.doesNotMatch(mapper, /used: Number\(credits\.ai\.used\)/);
	});

	it('keeps existing Facebook and Pinterest studio generation behavior', () => {
		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		assert.match(studio, /This will use ~\{estimatedCredits\} credits/);
		assert.match(studio, /handleGenerate/);
		assert.match(studio, /product\.destinationId === 'facebook'/);
	});
});

describe('WS-07 generation history row credits', () => {
	it('labels page sums as Credits on these rows, not wallet usage', () => {
		const history = readSrc('pages/app/AIPinHistoryPage.jsx');
		assert.match(history, /Credits on these rows/);
		assert.doesNotMatch(history, /label: 'Credits Used'/);
		assert.doesNotMatch(history, /credits used/);
		assert.match(history, /not wallet remaining/);
	});
});

describe('WS-07 analytics remaining independence', () => {
	it('does not use the Pinterest analytics fallback to set wallet remaining', () => {
		const analytics = readSrc('pages/app/AnalyticsPage.jsx');
		assert.match(analytics, /\/workspace\/v1\/credits/);
		assert.match(analytics, /mergeAnalyticsCreditsDisplay/);
		assert.match(analytics, /Used in range/);
		assert.match(analytics, /key !== 'creditsRemaining'/);
		assert.doesNotMatch(analytics, /\.\.\.\(payload\.summary \|\| \{\}\),/);
	});
});

describe('WS-07 Website Operate remaining visibility', () => {
	it('does not hide Credits Usage when remaining is 0 or problems exist', () => {
		const operate = readSrc('pages/app/WebsiteDashboardPage.jsx');
		assert.match(operate, /<SectionTitle>Credits Usage<\/SectionTitle>/);
		assert.match(operate, /Workspace credits/);
		assert.match(operate, /workspaceCreditsRemaining/);
		assert.equal((operate.match(/<SectionTitle>Credits Usage<\/SectionTitle>/g) || []).length, 1);
		assert.doesNotMatch(operate, /: \(\s*<Card>[\s\S]{0,200}<SectionTitle>Credits Usage/);
		assert.doesNotMatch(operate, /label="AI credits"/);
		assert.doesNotMatch(operate, /label="Image credits"/);
	});
});
