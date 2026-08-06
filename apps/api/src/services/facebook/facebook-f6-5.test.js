import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FACEBOOK_CHANNEL_CAPABILITIES,
	getFacebookChannelPackDto,
} from './channel-pack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('facebook F6-5 studio routes & asset capabilities', () => {
	it('enables studio asset capability flags', () => {
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.studioPromptPack, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.studioTemplatePack, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.studioExportProfiles, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.publishingHistory, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.insights, true);

		const dto = getFacebookChannelPackDto();
		assert.equal(dto.channelCapabilities.studioPromptPack, true);
		assert.equal(dto.channelCapabilities.studioTemplatePack, true);
		assert.equal(dto.channelCapabilities.studioExportProfiles, true);
		assert.equal(dto.channelCapabilities.publishingHistory, true);
	});

	it('wires Facebook product routes to ai-facebook-pages paths', () => {
		const products = readFileSync(
			path.join(root, 'apps/web/src/lib/studio/products.js'),
			'utf8',
		);
		const app = readFileSync(
			path.join(root, 'apps/web/src/App.jsx'),
			'utf8',
		);

		assert.match(products, /history:\s*'\/app\/ai-facebook-pages\/history'/);
		assert.match(products, /templates:\s*'\/app\/ai-facebook-pages\/templates'/);
		assert.match(products, /brandKit:\s*'\/app\/ai-facebook-pages\/brand-kit'/);
		assert.doesNotMatch(products, /AI_FACEBOOK_PAGES_PRODUCT[\s\S]*history:\s*'\/app\/ai-pins\/history'/);

		assert.match(app, /\/app\/ai-facebook-pages\/history/);
		assert.match(app, /\/app\/ai-facebook-pages\/templates/);
		assert.match(app, /\/app\/ai-facebook-pages\/brand-kit/);
		assert.match(app, /AIFacebookPagesHistoryPage/);
		assert.match(app, /AIFacebookPagesTemplatesPage/);
		assert.match(app, /AIFacebookPagesBrandKitPage/);
	});

	it('mirrors studio asset flags in web channel capabilities', () => {
		const caps = readFileSync(
			path.join(root, 'apps/web/src/lib/facebook/channelCapabilities.js'),
			'utf8',
		);

		assert.match(caps, /studioPromptPack:\s*true/);
		assert.match(caps, /studioTemplatePack:\s*true/);
		assert.match(caps, /studioExportProfiles:\s*true/);
		assert.match(caps, /publishingHistory:\s*true/);
	});

	it('gates publishing history UI on destination capability', () => {
		const studio = readFileSync(
			path.join(root, 'apps/web/src/pages/app/ContentStudioPage.jsx'),
			'utf8',
		);
		const modal = readFileSync(
			path.join(root, 'apps/web/src/components/ai-pins/PublishProgressModal.jsx'),
			'utf8',
		);

		assert.match(studio, /showPublishingHistory/);
		assert.match(studio, /destinationCaps\.publishingHistory/);
		assert.match(studio, /onOpenHistory=\{showPublishingHistory/);
		assert.match(modal, /onOpenHistory \?/);
	});

	it('preserves Pinterest product routes unchanged', () => {
		const products = readFileSync(
			path.join(root, 'apps/web/src/lib/studio/products.js'),
			'utf8',
		);

		assert.match(products, /AI_PINS_PRODUCT[\s\S]*history:\s*'\/app\/ai-pins\/history'/);
		assert.match(products, /AI_PINS_PRODUCT[\s\S]*templates:\s*'\/app\/ai-pins\/templates'/);
		assert.match(products, /AI_PINS_PRODUCT[\s\S]*brandKit:\s*'\/app\/ai-pins\/brand-kit'/);
		assert.match(products, /AI_PINS_PRODUCT[\s\S]*publishingHistory:\s*'\/app\/pinterest-history'/);
	});

	it('keeps frozen subsystems untouched for F6-5', () => {
		const queue = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/facebook-publish-queue.js'),
			'utf8',
		);
		const graph = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/graph-publish.js'),
			'utf8',
		);
		const migrations = readFileSync(
			path.join(root, 'apps/pocketbase/pb_migrations/1785400000_facebook_channel_pack.js'),
			'utf8',
		);

		assert.doesNotMatch(queue, /studioPromptPack/);
		assert.doesNotMatch(graph, /ai-facebook-pages/);
		assert.doesNotMatch(migrations, /studioTemplatePack/);
	});
});
