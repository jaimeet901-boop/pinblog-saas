/**
 * Runtime ensure: users collection create/update rules block privilege escalation.
 * Covers deployments that have not yet applied migration 1785500000.
 */
import logger from './logger.js';
import {
	buildUsersRules,
	usersRulesMatchHardened,
} from '../services/users-privileged-fields.js';

export async function ensureUsersPrivilegedRules(
	pocketbaseClient,
	{ getSettings } = {},
) {
	if (!pocketbaseClient?.collections?.getOne) {
		return { updated: false, reason: 'no_client' };
	}

	let collection;
	try {
		collection = await pocketbaseClient.collections.getOne('users');
	} catch (error) {
		logger.warn('users privileged rules ensure skipped (collection read failed)', {
			message: error?.message || String(error),
		});
		return { updated: false, reason: 'read_failed' };
	}

	let allowRegistration;
	try {
		const loadSettings = getSettings || (async () => {
			const { getPlatformSettings } = await import('../services/platform-settings.js');
			return getPlatformSettings();
		});
		const platform = await loadSettings();
		allowRegistration = platform?.settings?.general?.allowRegistration !== false;
	} catch (error) {
		// Do not risk reopening a manually closed registration policy when its
		// persisted setting cannot be read during startup.
		logger.warn('users registration policy ensure skipped (settings read failed)', {
			message: error?.message || String(error),
		});
	}

	const expected = buildUsersRules({ allowRegistration: allowRegistration ?? true });
	if (allowRegistration === undefined) delete expected.createRule;

	const match = usersRulesMatchHardened({
		createRule: collection.createRule,
		updateRule: collection.updateRule,
		allowRegistration,
	});

	const listOk = String(collection.listRule || '').replace(/\s+/g, ' ').trim()
		=== expected.listRule.replace(/\s+/g, ' ').trim();
	const viewOk = String(collection.viewRule || '').replace(/\s+/g, ' ').trim()
		=== expected.viewRule.replace(/\s+/g, ' ').trim();
	const deleteOk = String(collection.deleteRule || '').replace(/\s+/g, ' ').trim()
		=== expected.deleteRule.replace(/\s+/g, ' ').trim();

	const createOk = allowRegistration === undefined || match.createOk;
	if (createOk && match.updateOk && listOk && viewOk && deleteOk) {
		return { updated: false, reason: 'already_hardened' };
	}

	try {
		const updates = {
			listRule: expected.listRule,
			viewRule: expected.viewRule,
			updateRule: expected.updateRule,
			deleteRule: expected.deleteRule,
		};
		if (allowRegistration !== undefined) updates.createRule = expected.createRule;
		await pocketbaseClient.collections.update(collection.id, updates);
		logger.info('users privileged-field API rules applied (Critical #2)');
		return { updated: true, reason: 'applied' };
	} catch (error) {
		logger.warn('users privileged rules ensure failed', {
			message: error?.message || String(error),
		});
		return { updated: false, reason: 'update_failed', error: error?.message || String(error) };
	}
}
