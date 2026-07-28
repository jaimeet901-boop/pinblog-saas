/**
 * Idempotent seed of Chef IA official pin templates into ai_pin_templates.
 */

import crypto from 'node:crypto';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { listOfficialPinTemplateCatalog } from './official-pin-template-catalog.js';
import { validateTemplateConfiguration } from '../utils/template-config-validation.js';
import logger from '../utils/logger.js';

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

export async function ensureOfficialPinTemplatesSeeded() {
	if (seedInFlight) return seedInFlight;

	seedInFlight = (async () => {
		const ownerId = await resolveSeedOwnerId();
		if (!ownerId) {
			logger.warn('[official-templates] seed skipped — no users yet');
			return { seeded: 0, updated: 0, skipped: true, failed: 0 };
		}

		const catalog = listOfficialPinTemplateCatalog();
		let seeded = 0;
		let updated = 0;
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
						library: 'chefia-pin-library-v1',
					},
					deleted_at: '',
				};

				const existing = await findByTemplateUuid(entry.templateUuid);
				if (existing) {
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
					await pocketbaseClient.collection('ai_pin_templates').create(payload);
					seeded += 1;
				}
			} catch (error) {
				failed += 1;
				logger.warn('[official-templates] entry failed', {
					templateUuid: entry.templateUuid,
					message: error?.message || String(error),
				});
			}
		}

		logger.info('[official-templates] seed complete', {
			seeded,
			updated,
			failed,
			total: catalog.length,
		});
		return { seeded, updated, skipped: false, failed };
	})().finally(() => {
		seedInFlight = null;
	});

	return seedInFlight;
}
