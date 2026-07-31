/**
 * Runtime ensure: users collection create/update rules block privilege escalation.
 * Covers deployments that have not yet applied migration 1785500000.
 */
import logger from './logger.js';
import {
	buildUsersCreateRule,
	buildUsersDeleteRule,
	buildUsersListRule,
	buildUsersUpdateRule,
	buildUsersViewRule,
	usersRulesMatchHardened,
} from '../services/users-privileged-fields.js';

export async function ensureUsersPrivilegedRules(pocketbaseClient) {
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

	const expected = {
		listRule: buildUsersListRule(),
		viewRule: buildUsersViewRule(),
		createRule: buildUsersCreateRule(),
		updateRule: buildUsersUpdateRule(),
		deleteRule: buildUsersDeleteRule(),
	};

	const match = usersRulesMatchHardened({
		createRule: collection.createRule,
		updateRule: collection.updateRule,
	});

	const listOk = String(collection.listRule || '').replace(/\s+/g, ' ').trim()
		=== expected.listRule.replace(/\s+/g, ' ').trim();
	const viewOk = String(collection.viewRule || '').replace(/\s+/g, ' ').trim()
		=== expected.viewRule.replace(/\s+/g, ' ').trim();
	const deleteOk = String(collection.deleteRule || '').replace(/\s+/g, ' ').trim()
		=== expected.deleteRule.replace(/\s+/g, ' ').trim();

	if (match.createOk && match.updateOk && listOk && viewOk && deleteOk) {
		return { updated: false, reason: 'already_hardened' };
	}

	try {
		await pocketbaseClient.collections.update(collection.id, {
			listRule: expected.listRule,
			viewRule: expected.viewRule,
			createRule: expected.createRule,
			updateRule: expected.updateRule,
			deleteRule: expected.deleteRule,
		});
		logger.info('users privileged-field API rules applied (Critical #2)');
		return { updated: true, reason: 'applied' };
	} catch (error) {
		logger.warn('users privileged rules ensure failed', {
			message: error?.message || String(error),
		});
		return { updated: false, reason: 'update_failed', error: error?.message || String(error) };
	}
}
