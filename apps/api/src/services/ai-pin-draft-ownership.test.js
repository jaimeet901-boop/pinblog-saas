/**
 * AI-PINS-03 — POST /ai-pins/drafts website/article ownership.
 * Run: node --test src/services/ai-pin-draft-ownership.test.js
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	applySessionWorkspace,
	articleBelongsToWebsite,
	stripClientWorkspaceFields,
	validateDraftItemsOwnership,
} from './ai-pin-draft-ownership.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperSource = readFileSync(path.join(here, 'ai-pin-draft-ownership.js'), 'utf8');
const routeSource = readFileSync(path.join(here, '../routes/ai-pins.js'), 'utf8');

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

const reqA = {
	pocketbaseUserId: 'user-a',
	workspace: { id: 'ws-a', owner: 'owner-a' },
	workspaceKey: 'key-a',
};

function ownedStore() {
	const websites = new Map([
		['site-a', { id: 'site-a', workspace: 'ws-a', owner: 'owner-a' }],
		['site-b', { id: 'site-b', workspace: 'ws-b', owner: 'owner-b' }],
		['site-a2', { id: 'site-a2', workspace: 'ws-a', owner: 'owner-a' }],
	]);
	const articles = new Map([
		['art-a', { id: 'art-a', websiteId: 'site-a' }],
		['art-b', { id: 'art-b', websiteId: 'site-b' }],
		['art-a2', { id: 'art-a2', websiteId: 'site-a2' }],
	]);
	return { websites, articles };
}

function createOwnershipDeps(store = ownedStore()) {
	const websiteLookups = [];
	const articleLookups = [];
	return {
		websiteLookups,
		articleLookups,
		getOwnedWebsite: async ({ websiteId }) => {
			websiteLookups.push(websiteId);
			const site = store.websites.get(websiteId);
			if (!site) throw httpError(404, 'Website not found');
			if (site.workspace !== reqA.workspace.id) throw httpError(404, 'Website not found');
			return site;
		},
		getOwnedWebsiteArticle: async ({ articleId }) => {
			articleLookups.push(articleId);
			const article = store.articles.get(articleId);
			if (!article) throw httpError(404, 'Article not found');
			const site = store.websites.get(article.websiteId);
			if (!site || site.workspace !== reqA.workspace.id) throw httpError(404, 'Article not found');
			return article;
		},
	};
}

async function saveDraftsAfterOwnership(items, deps) {
	const creates = [];
	await validateDraftItemsOwnership(items, {
		req: reqA,
		getOwnedWebsite: deps.getOwnedWebsite,
		getOwnedWebsiteArticle: deps.getOwnedWebsiteArticle,
	});
	for (const item of items) {
		creates.push(applySessionWorkspace(stripClientWorkspaceFields(item), reqA));
	}
	return creates;
}

function draftsHandlerSource() {
	const start = routeSource.indexOf("router.post('/drafts'");
	const end = routeSource.indexOf("router.post('/pins/ensure-source-url'");
	assert.ok(start >= 0 && end > start, 'drafts handler not found');
	return routeSource.slice(start, end);
}

describe('AI-PINS-03 draft ownership validation', () => {
	it('valid own website + matching article creates successfully', async () => {
		const deps = createOwnershipDeps();
		const created = await saveDraftsAfterOwnership([
			{ websiteId: 'site-a', articleId: 'art-a', title: 'Own pin' },
		], deps);
		assert.equal(created.length, 1);
		assert.equal(created[0].websiteId, 'site-a');
		assert.equal(created[0].articleId, 'art-a');
		assert.equal(created[0].workspace, 'ws-a');
		assert.deepEqual(deps.websiteLookups, ['site-a']);
		assert.deepEqual(deps.articleLookups, ['art-a']);
	});

	it('foreign website is rejected and zero creates', async () => {
		const deps = createOwnershipDeps();
		await assert.rejects(
			() => saveDraftsAfterOwnership([
				{ websiteId: 'site-b', articleId: 'art-b', title: 'Foreign site' },
			], deps),
			(error) => error.status === 404,
		);
		assert.deepEqual(deps.websiteLookups, ['site-b']);
	});

	it('foreign article is rejected and zero creates', async () => {
		const deps = createOwnershipDeps();
		await assert.rejects(
			() => saveDraftsAfterOwnership([
				{ websiteId: 'site-a', articleId: 'art-b', title: 'Foreign article' },
			], deps),
			(error) => error.status === 404,
		);
	});

	it('article/website mismatch is rejected and zero creates', async () => {
		const deps = createOwnershipDeps();
		await assert.rejects(
			() => saveDraftsAfterOwnership([
				{ websiteId: 'site-a', articleId: 'art-a2', title: 'Wrong site' },
			], deps),
			(error) => error.status === 404 && /Article not found/.test(error.message),
		);
		assert.equal(articleBelongsToWebsite({ websiteId: 'site-a2' }, 'site-a'), false);
	});

	it('nonexistent website is rejected and zero creates', async () => {
		const deps = createOwnershipDeps();
		await assert.rejects(
			() => saveDraftsAfterOwnership([
				{ websiteId: 'missing-site', articleId: 'art-a', title: 'Missing site' },
			], deps),
			(error) => error.status === 404,
		);
	});

	it('nonexistent article is rejected and zero creates', async () => {
		const deps = createOwnershipDeps();
		await assert.rejects(
			() => saveDraftsAfterOwnership([
				{ websiteId: 'site-a', articleId: 'missing-art', title: 'Missing article' },
			], deps),
			(error) => error.status === 404,
		);
	});

	it('missing websiteId/articleId is rejected', async () => {
		const deps = createOwnershipDeps();
		await assert.rejects(
			() => saveDraftsAfterOwnership([{ articleId: 'art-a', title: 'No website' }], deps),
			(error) => error.status === 422 && /websiteId is required/.test(error.message),
		);
		await assert.rejects(
			() => saveDraftsAfterOwnership([{ websiteId: 'site-a', title: 'No article' }], deps),
			(error) => error.status === 422 && /articleId is required/.test(error.message),
		);
		assert.equal(deps.websiteLookups.length, 0);
		assert.equal(deps.articleLookups.length, 0);
	});

	it('batch where item 1 is valid and item 2 is foreign creates ZERO records', async () => {
		const deps = createOwnershipDeps();
		const creates = [];
		await assert.rejects(async () => {
			await validateDraftItemsOwnership([
				{ websiteId: 'site-a', articleId: 'art-a', title: 'Valid first' },
				{ websiteId: 'site-b', articleId: 'art-b', title: 'Foreign second' },
			], {
				req: reqA,
				getOwnedWebsite: deps.getOwnedWebsite,
				getOwnedWebsiteArticle: deps.getOwnedWebsiteArticle,
			});
			creates.push('created');
		}, (error) => error.status === 404);
		assert.equal(creates.length, 0);
		assert.deepEqual(deps.websiteLookups, ['site-a', 'site-b']);
	});

	it('client workspace override is ignored', () => {
		const stripped = stripClientWorkspaceFields({
			websiteId: 'site-a',
			articleId: 'art-a',
			workspace: 'ws-b',
			title: 'Forged workspace',
		});
		assert.equal(Object.prototype.hasOwnProperty.call(stripped, 'workspace'), false);
		const stamped = applySessionWorkspace({
			...stripped,
			workspace: 'ws-b',
		}, reqA);
		assert.equal(stamped.workspace, 'ws-a');
	});

	it('client channel override is stripped', () => {
		const stripped = stripClientWorkspaceFields({
			websiteId: 'site-a',
			articleId: 'art-a',
			channel: 'facebook',
			title: 'Forged channel',
		});
		assert.equal(Object.prototype.hasOwnProperty.call(stripped, 'channel'), false);
	});

	it('client workspaceKey override is ignored', () => {
		const stripped = stripClientWorkspaceFields({
			websiteId: 'site-a',
			articleId: 'art-a',
			workspaceKey: 'key-b',
			workspace_key: 'key-b',
			title: 'Forged key',
		});
		assert.equal(Object.prototype.hasOwnProperty.call(stripped, 'workspaceKey'), false);
		assert.equal(Object.prototype.hasOwnProperty.call(stripped, 'workspace_key'), false);
		const stamped = applySessionWorkspace({
			...stripped,
			workspaceKey: 'key-b',
			workspace_key: 'key-b',
		}, reqA);
		assert.equal(stamped.workspace, 'ws-a');
		assert.equal(stamped.workspaceKey, undefined);
		assert.equal(stamped.workspace_key, undefined);
	});
});

describe('AI-PINS-03 drafts route wiring', () => {
	it('validates every item with getOwnedWebsite and getOwnedWebsiteArticle before the first create', () => {
		const handler = draftsHandlerSource();
		const validateAt = handler.indexOf('validateDraftItemsOwnership(items');
		const createAt = handler.indexOf("collection('ai_pins').create");
		assert.ok(validateAt >= 0, 'drafts must call validateDraftItemsOwnership');
		assert.ok(createAt > validateAt, 'ownership validation must run before ai_pins.create');
		assert.match(handler, /getOwnedWebsite,/);
		assert.match(handler, /getOwnedWebsiteArticle,/);
		assert.match(helperSource, /await getOwnedWebsite\(\{ websiteId, req \}\)/);
		assert.match(helperSource, /await getOwnedWebsiteArticle\(\{ articleId, req \}\)/);
		assert.match(helperSource, /articleBelongsToWebsite\(article, websiteId\)/);
	});

	it('forces session workspace and strips client workspace fields', () => {
		const handler = draftsHandlerSource();
		assert.match(handler, /stripClientWorkspaceFields\(item\)/);
		assert.match(handler, /applySessionWorkspace\(/);
		assert.doesNotMatch(handler, /stampCreateOwnership\(req, \{\s*\.\.\.item,/);
	});

	it('requires allowlisted request channel and server-stamps after stripping item.channel', () => {
		const handler = draftsHandlerSource();
		assert.match(handler, /parseRequiredStudioChannel\(req\.body\?\.channel\)/);
		assert.match(handler, /channel: stampedChannel/);
		assert.ok(
			handler.indexOf('parseRequiredStudioChannel') < handler.indexOf("collection('ai_pins').create"),
			'channel must be validated before create',
		);
		assert.ok(
			handler.indexOf('stripClientWorkspaceFields(item)') < handler.indexOf('channel: stampedChannel'),
			'server stamp must overwrite stripped client channel',
		);
	});

	it('duplicate loads source pin and preserves DB channel before create', () => {
		const handler = draftsHandlerSource();
		assert.match(handler, /duplicateFromPinId/);
		assert.match(handler, /stampDraftChannel\(/);
		assert.ok(
			handler.indexOf('duplicateFromPinId') < handler.indexOf("collection('ai_pins').create"),
			'duplicate source load must run before create',
		);
	});
});
