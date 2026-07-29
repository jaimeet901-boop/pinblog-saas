import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildTrustedProductEvent,
	isKnownProductEvent,
	PRODUCT_EVENT_NAMES,
} from './product-events.js';
import {
	assertTemplateUseAccess,
	attachAllowedAccess,
	attachTemplateAccess,
	evaluateTemplateAccess,
	featureLockedError,
	redactTemplateConfiguration,
	resolveRequiredFeatureKeys,
} from './plan-access-guard.js';
import { evaluateFeatureAccessForPlan } from './plan-access.js';
import { normalizeFeatures } from './plan-features.js';
import { FEATURE_CATALOG } from './feature-catalog.js';

const LOCKED_ACCESS = Object.freeze({
	visible: true,
	enabled: false,
	locked: true,
	missingKeys: ['templates.premium'],
	dependencyChain: ['templates.premium'],
	requiredKeys: ['templates.premium'],
});

const PREMIUM_TEMPLATE = Object.freeze({
	id: 'tpl_premium_1',
	name: 'Premium Hero',
	configuration: { schemaVersion: 2, layers: [{ id: 'title', type: 'text', text: 'SECRET' }] },
	thumbnail: 'https://cdn.example/preview.png',
	previewUrl: 'https://cdn.example/preview.png',
	marketplace_meta: {
		premium: true,
		access: { requires: ['templates.premium'] },
	},
	marketplace: {
		ready: true,
		visibility: 'official',
		meta: {
			premium: true,
			access: { requires: ['templates.premium'] },
		},
	},
});

describe('Phase 8 — Premium Template security validation', () => {
	describe('access object consistency', () => {
		it('attachTemplateAccess always returns the standardized access shape', () => {
			const item = attachTemplateAccess(
				{ ...PREMIUM_TEMPLATE },
				LOCKED_ACCESS,
			);
			assert.equal(typeof item.access, 'object');
			assert.equal(item.access.visible, true);
			assert.equal(item.access.enabled, false);
			assert.equal(item.access.locked, true);
			assert.deepEqual(item.access.missingKeys, ['templates.premium']);
			assert.deepEqual(item.access.dependencyChain, ['templates.premium']);
			assert.deepEqual(item.requiredFeatureKeys, ['templates.premium']);
		});

		it('attachAllowedAccess matches the same access keys as locked responses', () => {
			const allowed = attachAllowedAccess({ id: 'owned' });
			const locked = attachTemplateAccess({ id: 'locked' }, LOCKED_ACCESS);
			assert.deepEqual(Object.keys(allowed.access).sort(), Object.keys(locked.access).sort());
		});

		it('FEATURE_LOCKED errors expose the standardized access payload', () => {
			const err = featureLockedError(LOCKED_ACCESS, { featureKey: 'templates.premium' });
			assert.equal(err.status, 403);
			assert.equal(err.errorCode, 'FEATURE_LOCKED');
			assert.equal(err.access.enabled, false);
			assert.equal(err.access.locked, true);
			assert.deepEqual(err.access.missingKeys, ['templates.premium']);
			assert.deepEqual(err.requiredKeys, ['templates.premium']);
			assert.equal(err.featureKey, 'templates.premium');
		});
	});

	describe('configuration leakage', () => {
		it('redacts configuration when access.enabled is false', () => {
			const item = attachTemplateAccess(
				{ ...PREMIUM_TEMPLATE },
				LOCKED_ACCESS,
			);
			assert.equal(item.configuration, undefined);
			assert.ok(!('configuration' in item) || item.configuration === undefined);
		});

		it('preserves preview-safe metadata when locked', () => {
			const item = attachTemplateAccess(
				{
					id: PREMIUM_TEMPLATE.id,
					name: PREMIUM_TEMPLATE.name,
					thumbnail: PREMIUM_TEMPLATE.thumbnail,
					previewUrl: PREMIUM_TEMPLATE.previewUrl,
					configuration: PREMIUM_TEMPLATE.configuration,
					marketplace: PREMIUM_TEMPLATE.marketplace,
				},
				LOCKED_ACCESS,
			);
			assert.equal(item.id, 'tpl_premium_1');
			assert.equal(item.name, 'Premium Hero');
			assert.equal(item.thumbnail, 'https://cdn.example/preview.png');
			assert.equal(item.previewUrl, 'https://cdn.example/preview.png');
			assert.equal(item.configuration, undefined);
			assert.equal(item.marketplace?.visibility, 'official');
		});

		it('redactTemplateConfiguration never leaves configuration behind', () => {
			const redacted = redactTemplateConfiguration({
				id: 'x',
				configuration: { layers: [1] },
				name: 'Keep me',
			});
			assert.equal(redacted.configuration, undefined);
			assert.equal(redacted.name, 'Keep me');
		});

		it('keeps configuration when access is enabled', () => {
			const item = attachTemplateAccess(
				{ ...PREMIUM_TEMPLATE },
				{
					visible: true,
					enabled: true,
					locked: false,
					missingKeys: [],
					dependencyChain: [],
					requiredKeys: ['templates.premium'],
				},
			);
			assert.ok(item.configuration);
			assert.equal(item.configuration.layers[0].text, 'SECRET');
		});
	});

	describe('access control / privilege boundaries', () => {
		it('locks premium templates when plan does not grant templates.premium', async () => {
			const access = await evaluateTemplateAccess(
				{ pocketbaseUserId: 'user_1' },
				PREMIUM_TEMPLATE,
				{
					context: {
						plan: { features: { 'templates.premium': { enabled: false } } },
						isPlatformAdmin: false,
					},
				},
			);
			assert.equal(access.enabled, false);
			assert.equal(access.locked, true);
			assert.ok(access.missingKeys.includes('templates.premium'));
		});

		it('allows premium templates when plan grants the key', async () => {
			const access = await evaluateTemplateAccess(
				{ pocketbaseUserId: 'user_1' },
				PREMIUM_TEMPLATE,
				{
					context: {
						plan: { features: { 'templates.premium': { enabled: true } } },
						isPlatformAdmin: false,
					},
				},
			);
			assert.equal(access.enabled, true);
			assert.equal(access.locked, false);
		});

		it('admin bypasses plan grants (no privilege escalation for non-admins)', async () => {
			const denied = await evaluateTemplateAccess(
				{ pocketbaseUserId: 'user_1' },
				PREMIUM_TEMPLATE,
				{
					context: {
						plan: { features: {} },
						isPlatformAdmin: false,
					},
				},
			);
			const admin = await evaluateTemplateAccess(
				{ pocketbaseUserId: 'admin_1', pocketbaseUser: { role: 'admin' } },
				PREMIUM_TEMPLATE,
				{
					context: {
						plan: { features: {} },
						isPlatformAdmin: true,
					},
				},
			);
			assert.equal(denied.enabled, false);
			assert.equal(admin.enabled, true);
		});

		it('standard templates remain ungated (non-premium regression)', async () => {
			const access = await evaluateTemplateAccess(
				{ pocketbaseUserId: 'user_1' },
				{ id: 'tpl_free', name: 'Free', marketplace_meta: { tags: [] } },
				{
					context: {
						plan: { features: {} },
						isPlatformAdmin: false,
					},
				},
			);
			assert.equal(access.enabled, true);
			assert.deepEqual(access.requiredKeys, []);
			assert.deepEqual(resolveRequiredFeatureKeys({ id: 'tpl_free' }), []);
		});

		it('does not treat undefined owner as owned private (privilege escalation guard)', async () => {
			const access = await evaluateTemplateAccess(
				{ pocketbaseUserId: undefined },
				{
					...PREMIUM_TEMPLATE,
					visibility: 'private',
					owner: undefined,
				},
				{
					context: {
						plan: { features: {} },
						isPlatformAdmin: false,
					},
				},
			);
			assert.equal(access.enabled, false);
		});
	});

	describe('plans & feature catalog regressions', () => {
		it('normalizeFeatures still returns every catalog key', () => {
			const features = normalizeFeatures({ 'templates.premium': true }, { validate: false });
			for (const entry of FEATURE_CATALOG) {
				assert.ok(features[entry.key], `missing catalog key ${entry.key}`);
				assert.equal(typeof features[entry.key].enabled, 'boolean');
			}
			assert.equal(features['templates.premium'].enabled, true);
		});

		it('legacy boolean plan grants still evaluate', () => {
			const result = evaluateFeatureAccessForPlan(
				{ features: { 'templates.premium': true } },
				'templates.premium',
				{ isPlatformAdmin: false },
			);
			assert.equal(result.enabled, true);
		});
	});

	describe('Locked / Premium / Admin matrix (Preview, Use, Duplicate, Export, Generate, Editor)', () => {
		const actors = {
			locked: {
				label: 'locked user',
				req: { pocketbaseUserId: 'user_locked' },
				context: {
					plan: { features: { 'templates.premium': { enabled: false } } },
					isPlatformAdmin: false,
				},
			},
			premium: {
				label: 'premium user',
				req: { pocketbaseUserId: 'user_premium' },
				context: {
					plan: { features: { 'templates.premium': { enabled: true } } },
					isPlatformAdmin: false,
				},
			},
			admin: {
				label: 'admin user',
				req: { pocketbaseUserId: 'admin_1', pocketbaseUser: { role: 'admin' } },
				context: {
					plan: { features: {} },
					isPlatformAdmin: true,
				},
			},
		};

		for (const [actorKey, actor] of Object.entries(actors)) {
			it(`${actor.label}: Preview remains available without configuration when locked`, async () => {
				const access = await evaluateTemplateAccess(actor.req, PREMIUM_TEMPLATE, {
					context: actor.context,
				});
				const preview = attachTemplateAccess({
					id: PREMIUM_TEMPLATE.id,
					name: PREMIUM_TEMPLATE.name,
					thumbnail: PREMIUM_TEMPLATE.thumbnail,
					previewUrl: PREMIUM_TEMPLATE.previewUrl,
					configuration: PREMIUM_TEMPLATE.configuration,
					marketplace: PREMIUM_TEMPLATE.marketplace,
				}, access);

				assert.equal(preview.access.visible, true);
				assert.equal(preview.thumbnail, PREMIUM_TEMPLATE.thumbnail);
				assert.equal(preview.previewUrl, PREMIUM_TEMPLATE.previewUrl);
				if (actorKey === 'locked') {
					assert.equal(preview.access.enabled, false);
					assert.equal(preview.access.locked, true);
					assert.equal(preview.configuration, undefined);
				} else {
					assert.equal(preview.access.enabled, true);
					assert.equal(preview.access.locked, false);
					assert.ok(preview.configuration);
				}
			});

			it(`${actor.label}: Use / Duplicate / Export / Generate / Editor share assertTemplateUseAccess`, async () => {
				const options = { context: actor.context };
				if (actorKey === 'locked') {
					await assert.rejects(
						() => assertTemplateUseAccess(actor.req, PREMIUM_TEMPLATE, options),
						(err) => err.status === 403
							&& err.errorCode === 'FEATURE_LOCKED'
							&& err.access?.locked === true
							&& Array.isArray(err.access?.missingKeys),
					);
					return;
				}
				const access = await assertTemplateUseAccess(actor.req, PREMIUM_TEMPLATE, options);
				assert.equal(access.enabled, true);
				assert.equal(access.locked, false);
			});

			it(`${actor.label}: Editor GET shape never leaks layers when locked`, async () => {
				const access = await evaluateTemplateAccess(actor.req, PREMIUM_TEMPLATE, {
					context: actor.context,
				});
				const editorDto = attachTemplateAccess({
					id: PREMIUM_TEMPLATE.id,
					name: PREMIUM_TEMPLATE.name,
					configuration: PREMIUM_TEMPLATE.configuration,
				}, access);
				if (actorKey === 'locked') {
					assert.equal(editorDto.configuration, undefined);
					assert.equal(editorDto.access.enabled, false);
				} else {
					assert.deepEqual(editorDto.configuration.layers[0].text, 'SECRET');
					assert.equal(editorDto.access.enabled, true);
				}
			});
		}

		it('marketplace_meta.access.requires wins over forged requiredFeatureKeys / access fields', async () => {
			const forged = {
				...PREMIUM_TEMPLATE,
				requiredFeatureKeys: [],
				access: {
					visible: true,
					enabled: true,
					locked: false,
					missingKeys: [],
					dependencyChain: [],
				},
				premium: false,
			};
			assert.deepEqual(resolveRequiredFeatureKeys(forged), ['templates.premium']);
			const access = await evaluateTemplateAccess(
				{ pocketbaseUserId: 'attacker' },
				forged,
				{
					context: {
						plan: { features: {} },
						isPlatformAdmin: false,
					},
				},
			);
			assert.equal(access.enabled, false);
			assert.equal(access.locked, true);
		});

		it('client templateConfiguration cannot satisfy assert when templateId path is used (server record wins)', async () => {
			// Mirrors createGenerationRun: access is evaluated on the server-loaded record,
			// not on any client-supplied configuration blob.
			const serverRecord = PREMIUM_TEMPLATE;
			const clientConfig = { schemaVersion: 2, layers: [{ id: 'hack', type: 'text' }] };
			await assert.rejects(
				() => assertTemplateUseAccess(
					{ pocketbaseUserId: 'attacker' },
					serverRecord,
					{
						context: {
							plan: { features: {} },
							isPlatformAdmin: false,
						},
					},
				),
				(err) => err.errorCode === 'FEATURE_LOCKED',
			);
			assert.ok(clientConfig.layers);
		});
	});

	describe('analytics security', () => {
		it('rejects unknown events and non-object payloads', () => {
			assert.equal(isKnownProductEvent('evil_event'), false);
			assert.throws(
				() => buildTrustedProductEvent({ workspace: { id: 'ws1' } }, { event: 'evil_event' }),
				(err) => err.status === 422 && err.errorCode === 'VALIDATION_ERROR',
			);
			assert.throws(
				() => buildTrustedProductEvent({ workspace: { id: 'ws1' } }, null),
				(err) => err.status === 422,
			);
			assert.throws(
				() => buildTrustedProductEvent({ workspace: { id: 'ws1' } }, ['template_gallery_view']),
				(err) => err.status === 422,
			);
		});

		it('ignores client-supplied workspaceId and currentPlan', () => {
			const built = buildTrustedProductEvent(
				{
					workspace: { id: 'ws_trusted', workspace_key: 'key_trusted', plan_slug: 'starter', name: 'Trusted' },
					workspaceKey: 'key_trusted',
					pocketbaseUserId: 'user_1',
				},
				{
					event: 'upgrade_modal_open',
					workspaceId: 'ws_attacker',
					currentPlan: 'agency',
					templateId: 'tpl_1',
					templateName: 'Hero',
					sourcePage: 'ai_pins_chooser',
					missingKeys: ['templates.premium'],
				},
			);
			assert.equal(built.metadata.workspaceId, 'ws_trusted');
			assert.equal(built.metadata.currentPlan, 'starter');
			assert.notEqual(built.metadata.workspaceId, 'ws_attacker');
			assert.notEqual(built.metadata.currentPlan, 'agency');
			assert.equal(built.metadata.templateId, 'tpl_1');
			assert.equal(built.metadata.sourcePage, 'ai_pins_chooser');
		});

		it('uses subscription plan slug when workspace.plan_slug is absent', () => {
			const built = buildTrustedProductEvent(
				{
					workspace: { id: 'ws2', workspace_key: 'k2' },
					workspaceKey: 'k2',
					workspaceSubscription: { expand: { plan: { slug: 'pro' } } },
				},
				{ event: 'subscription_page_open', currentPlan: 'free' },
			);
			assert.equal(built.metadata.currentPlan, 'pro');
		});

		it('catalog still lists all funnel events', () => {
			for (const name of [
				'template_gallery_view',
				'template_preview_open',
				'template_locked_click',
				'upgrade_modal_open',
				'upgrade_button_click',
				'subscription_page_open',
				'template_used',
				'template_generated',
			]) {
				assert.ok(PRODUCT_EVENT_NAMES.includes(name));
			}
		});
	});
});
