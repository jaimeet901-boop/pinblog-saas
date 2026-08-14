/**
 * Runtime ensure for billing automation fields + idempotency collection.
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

	logger.warn('Adding missing billing automation fields', {
		collection: collectionName,
		missing: missing.map((field) => field.name),
	});

	collection = await pocketbaseClient.collections.update(collection.id, {
		fields: [...getFieldsArray(collection), ...missing],
	});
	clearCollectionSchemaCache(collectionName);
	return collection;
}

const BILLING_EVENT_TYPES = [
	'upgrade', 'downgrade', 'trial_start', 'trial_end', 'plan_assign',
	'reset', 'suspend', 'unsuspend', 'topup',
	'renewed', 'cancelled', 'payment_failed', 'credits_purchased',
	'credits_expired', 'manual_adjustment', 'grace_start', 'grace_end',
];

export async function ensureBillingAutomationSchema(pocketbaseClient) {
	await ensureFields(pocketbaseClient, 'workspace_subscriptions', [
		buildDateField('trial_ends_at'),
		buildDateField('grace_period_ends_at'),
		buildBoolField('cancel_at_period_end'),
		buildTextField('pending_plan', 64),
		buildTextField('last_payment_status', 40),
		buildDateField('last_payment_at'),
		buildTextField('provider', 40),
		buildTextField('provider_subscription_id', 120),
		buildNumberField('monthly_credits_balance'),
		buildTextField('notified_credit_thresholds', 120),
		buildTextField('owner_user', 64),
	]);

	const events = await pocketbaseClient.collections.getOne('billing_events').catch(() => null);
	if (events) {
		const fields = getFieldsArray(events);
		const eventField = fields.find((field) => field.name === 'event_type');
		if (eventField && eventField.type === 'select') {
			const current = Array.isArray(eventField.values) ? eventField.values : [];
			const merged = [...new Set([...current, ...BILLING_EVENT_TYPES])];
			if (merged.length !== current.length) {
				eventField.values = merged;
				await pocketbaseClient.collections.update(events.id, { fields });
				clearCollectionSchemaCache('billing_events');
			}
		}
	}

	const idemFields = [
		{ ...buildTextField('idempotency_key', 180), required: true },
		buildTextField('scope', 40),
		buildTextField('workspace_key', 120),
		buildTextField('provider', 40),
		buildTextField('event_type', 120),
		{ ...buildSelectField('status', ['processing', 'completed', 'failed']), required: true },
		buildJsonField('payload'),
		buildJsonField('result'),
		buildDateField('processed_at'),
		buildAutodateField('created', { onCreate: true, onUpdate: false }),
		buildAutodateField('updated', { onCreate: true, onUpdate: true }),
	];
	const idemIndexes = [
		'CREATE UNIQUE INDEX `idx_billing_idempotency_key` ON `billing_idempotency` (`idempotency_key`)',
		'CREATE INDEX `idx_billing_idempotency_ws` ON `billing_idempotency` (`workspace_key`, `created`)',
	];

	let idem = await pocketbaseClient.collections.getOne('billing_idempotency').catch(() => null);
	if (!idem) {
		idem = await pocketbaseClient.collections.create({
			name: 'billing_idempotency',
			type: 'base',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: idemFields,
			indexes: idemIndexes,
		}).catch((error) => {
			logger.warn('billing_idempotency create skipped', { message: error?.message || String(error) });
			return null;
		});
		if (idem) clearCollectionSchemaCache('billing_idempotency');
	} else {
		const missing = idemFields.filter((field) => !hasField(idem, field.name));
		const indexes = Array.isArray(idem.indexes) ? [...idem.indexes] : [];
		for (const sql of idemIndexes) {
			const marker = sql.includes('_ws') ? 'idx_billing_idempotency_ws' : 'idx_billing_idempotency_key';
			if (!indexes.some((item) => String(item).includes(marker))) indexes.push(sql);
		}
		const indexesChanged = JSON.stringify(indexes) !== JSON.stringify(idem.indexes || []);
		if (missing.length || indexesChanged) {
			logger.warn('Healing billing_idempotency husk/incomplete schema', {
				missing: missing.map((field) => field.name),
			});
			idem = await pocketbaseClient.collections.update(idem.id, {
				fields: [...getFieldsArray(idem), ...missing],
				indexes,
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
			});
			clearCollectionSchemaCache('billing_idempotency');
		}
	}

	return { idempotencyReady: Boolean(idem) };
}
