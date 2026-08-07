/**
 * Bootstrap / recovery seed of Chef IA official pin templates into ai_pin_templates.
 *
 * Modes:
 *   bootstrap (default) — create missing catalog rows only; never overwrite existing (Admin wins).
 *   recover             — overwrite catalog rows from code (disaster recovery / explicit ops).
 */

import crypto from 'node:crypto';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { listOfficialPinTemplateCatalog } from './official-pin-template-catalog.js';
import { validateTemplateConfiguration } from '../utils/template-config-validation.js';
import logger from '../utils/logger.js';

const VALID_SEED_MODES = Object.freeze(['bootstrap', 'recover']);

function resolveSeedMode(options = {}) {
	const fromOptions = String(options.mode || '').trim().toLowerCase();
	if (VALID_SEED_MODES.includes(fromOptions)) return fromOptions;
	const fromEnv = String(process.env.OFFICIAL_TEMPLATES_SEED_MODE || '').trim().toLowerCase();
	if (VALID_SEED_MODES.includes(fromEnv)) return fromEnv;
	return 'bootstrap';
}

function checksumOf(configuration) {
	return crypto
		.createHash('sha256')
		.update(JSON.stringify(configuration || {}))
		.digest('hex')
		.slice(0, 32);
}

async function resolveSeedOwnerId() {
	try {
		const users = await pocketbaseClient.collection('users').getList(1, 1, {
			sort: 'created',
			fields: 'id',
			requestKey: null,
		});
		return users.items?.[0]?.id || null;
	} catch {
		return null;
	}
}

/** Platform library owner — first user; official catalog rows are seeded under this account. */
export async function resolvePlatformLibraryOwnerId() {
	return resolveSeedOwnerId();
}

async function findByTemplateUuid(templateUuid) {
	try {
		const result = await pocketbaseClient.collection('ai_pin_templates').getList(1, 1, {
			filter: pocketbaseClient.filter('template_uuid = {:uuid}', { uuid: templateUuid }),
			requestKey: null,
		});
		return result.items?.[0] || null;
	} catch {
		return null;
	}
}

let seedInFlight = null;

export async function bootstrapOfficialPinTemplates(options = {}) {
	if (seedInFlight) return seedInFlight;

	const mode = resolveSeedMode(options);

	seedInFlight = (async () => {
		const ownerId = await resolveSeedOwnerId();
		if (!ownerId) {
			logger.warn('[official-templates] seed skipped — no users yet');
			return { mode, seeded: 0, updated: 0, unchanged: 0, skippedRun: true, failed: 0 };
		}

		const catalog = listOfficialPinTemplateCatalog();
		let seeded = 0;
		let updated = 0;
		let unchanged = 0;
		let failed = 0;

		for (const entry of catalog) {
			try {
				const validated = validateTemplateConfiguration(entry.configuration);
				if (!validated.ok) {
					failed += 1;
					logger.warn('[official-templates] invalid config skipped', {
						templateUuid: entry.templateUuid,
						issues: validated.issues,
					});
					continue;
				}
				const configuration = validated.configuration;
				const checksum = checksumOf(configuration);
				const payload = {
					owner: ownerId,
					created_by: ownerId,
					name: entry.name,
					thumbnail: entry.thumbnail || '',
					configuration,
					is_default: false,
					category: entry.category || 'general',
					status: 'published',
					visibility: 'official',
					template_uuid: entry.templateUuid,
					config_checksum: checksum,
					revision: 1,
					editor_version: 1,
					schema_version: 1,
					marketplace_meta: {
						tags: entry.tags || [],
						official: true,
						library: entry.channel === 'facebook' ? 'chefia-facebook-library-v1' : 'chefia-pin-library-v1',
						channel: entry.channel || 'pinterest',
						pack: entry.channel === 'facebook' ? 'facebook' : 'pinterest',
					},
					deleted_at: '',
				};

				const existing = await findByTemplateUuid(entry.templateUuid);
				if (existing) {
					if (mode === 'recover') {
						await pocketbaseClient.collection('ai_pin_templates').update(existing.id, {
							name: payload.name,
							thumbnail: payload.thumbnail,
							configuration: payload.configuration,
							category: payload.category,
							status: 'published',
							visibility: 'official',
							config_checksum: payload.config_checksum,
							marketplace_meta: payload.marketplace_meta,
							deleted_at: '',
						});
						updated += 1;
					} else {
						unchanged += 1;
					}
					continue;
				}

				await pocketbaseClient.collection('ai_pin_templates').create(payload);
				seeded += 1;
			} catch (error) {
				failed += 1;
				logger.warn('[official-templates] entry failed', {
					templateUuid: entry.templateUuid,
					message: error?.message || String(error),
				});
			}
		}

		logger.info('[official-templates] seed complete', {
			mode,
			seeded,
			updated,
			unchanged,
			failed,
			total: catalog.length,
		});
		return { mode, seeded, updated, unchanged, skippedRun: false, failed };
	})().finally(() => {
		seedInFlight = null;
	});

	return seedInFlight;
}

/** @deprecated alias — prefer bootstrapOfficialPinTemplates */
export async function ensureOfficialPinTemplatesSeeded(options = {}) {
	return bootstrapOfficialPinTemplates(options);
}

export async function recoverOfficialPinTemplates(options = {}) {
	return bootstrapOfficialPinTemplates({ ...options, mode: 'recover' });
}
