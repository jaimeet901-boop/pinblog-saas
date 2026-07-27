/**
 * Runtime ensure for Credits Engine schema fields / collections.
 */
import logger from './logger.js';
import { extractCollectionFieldNames, clearCollectionSchemaCache } from './pocketbase-safe-query.js';

function fieldNames(model) {
	return extractCollectionFieldNames(model);
}

function getFieldsArray(model) {
	if (Array.isArray(model?.fields)) return model.fields;
	if (Array.isArray(model?.schema)) return model.schema;
	return [];
}

function hasField(model, name) {
	return fieldNames(model).has(name);
}

function buildTextField(name, max = 0) {
	return { name, type: 'text', ...(max ? { max } : {}) };
}

function buildNumberField(name) {
	return { name, type: 'number', min: 0 };
}

function buildBoolField(name) {
	return { name, type: 'bool' };
}

function buildDateField(name) {
	return { name, type: 'date' };
}

function buildJsonField(name, maxSize = 200000) {
	return { name, type: 'json', maxSize };
}

function buildSelectField(name, values) {
	return { name, type: 'select', maxSelect: 1, values };
}

function buildAutodateField(name, { onCreate = true, onUpdate = false } = {}) {
	return { name, type: 'autodate', onCreate, onUpdate };
}

async function ensureFields(pocketbaseClient, collectionName, requiredFields) {
	let collection = await pocketbaseClient.collections.getOne(collectionName).catch(() => null);
	if (!collection) return null;
	const missing = requiredFields.filter((field) => !hasField(collection, field.name));
	if (!missing.length) return collection;

	logger.warn('Adding missing credits engine fields', {
		collection: collectionName,
		missing: missing.map((field) => field.name),
	});

	collection = await pocketbaseClient.collections.update(collection.id, {
		fields: [...getFieldsArray(collection), ...missing],
	});
	clearCollectionSchemaCache(collectionName);
	return collection;
}

export async function ensureCreditsEngineSchema(pocketbaseClient) {
	await ensureFields(pocketbaseClient, 'plans', [
		buildJsonField('credit_costs'),
		buildJsonField('trial_config'),
		buildJsonField('upgrade_rules'),
		buildJsonField('downgrade_rules'),
		buildJsonField('topup_packs'),
	]);

	await ensureFields(pocketbaseClient, 'credit_transactions', [
		buildTextField('feature', 80),
		buildTextField('idempotency_key', 120),
		buildTextField('reservation_id', 64),
		buildTextField('reference_id', 120),
	]);

	await ensureFields(pocketbaseClient, 'workspace_subscriptions', [
		buildNumberField('purchased_credits'),
		buildNumberField('bonus_credits_balance'),
		buildNumberField('credits_used_total'),
		buildBoolField('credits_suspended'),
		buildDateField('last_credit_reset_at'),
		buildTextField('billing_status', 40),
	]);

	let reservations = await pocketbaseClient.collections.getOne('credit_reservations').catch(() => null);
	if (!reservations) {
		reservations = await pocketbaseClient.collections.create({
			name: 'credit_reservations',
			type: 'base',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				{ ...buildTextField('workspace_key', 120), required: true },
				buildTextField('workspace_name', 200),
				{ ...buildNumberField('amount'), required: true },
				buildTextField('feature', 80),
				buildSelectField('status', ['reserved', 'committed', 'released', 'expired']),
				buildTextField('reason', 500),
				buildTextField('reference_id', 120),
				buildTextField('idempotency_key', 120),
				buildDateField('expires_at'),
				buildJsonField('metadata'),
				buildTextField('created_by_user', 64),
				buildAutodateField('created', { onCreate: true, onUpdate: false }),
				buildAutodateField('updated', { onCreate: true, onUpdate: true }),
			],
			indexes: [
				'CREATE INDEX `idx_credit_reservations_ws` ON `credit_reservations` (`workspace_key`, `status`)',
			],
		}).catch((error) => {
			logger.warn('credit_reservations create skipped', { message: error?.message || String(error) });
			return null;
		});
	}

	let billingEvents = await pocketbaseClient.collections.getOne('billing_events').catch(() => null);
	if (!billingEvents) {
		billingEvents = await pocketbaseClient.collections.create({
			name: 'billing_events',
			type: 'base',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				{ ...buildTextField('workspace_key', 120), required: true },
				buildTextField('workspace_name', 200),
				buildSelectField('event_type', [
					'upgrade', 'downgrade', 'trial_start', 'trial_end', 'plan_assign',
					'reset', 'suspend', 'unsuspend', 'topup',
				]),
				buildTextField('from_plan', 80),
				buildTextField('to_plan', 80),
				buildTextField('actor', 120),
				buildTextField('message', 1000),
				buildJsonField('metadata'),
				buildDateField('occurred_at'),
				buildAutodateField('created', { onCreate: true, onUpdate: false }),
				buildAutodateField('updated', { onCreate: true, onUpdate: true }),
			],
			indexes: [
				'CREATE INDEX `idx_billing_events_ws` ON `billing_events` (`workspace_key`, `occurred_at`)',
			],
		}).catch((error) => {
			logger.warn('billing_events create skipped', { message: error?.message || String(error) });
			return null;
		});
	}

	return {
		reservationsReady: Boolean(reservations),
		billingEventsReady: Boolean(billingEvents),
	};
}
