#!/usr/bin/env node
/**
 * Module 1 schema verification — Template Engine collections & indexes.
 *
 * From apps/api (has pocketbase dependency):
 *   node ../pocketbase/scripts/verify-template-engine-schema.mjs
 *
 * Env:
 *   POCKETBASE_URL (default http://127.0.0.1:8090)
 *   POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD
 *   (or PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD)
 */

import PocketBase from 'pocketbase';
import {
	TEMPLATE_CATEGORIES,
	TEMPLATE_STATUS,
	TEMPLATE_VISIBILITY,
	TEMPLATE_ENGINE_COLLECTIONS,
} from '../../api/src/constants/pin-engine.js';

const EXPECTED_COLLECTIONS = [...TEMPLATE_ENGINE_COLLECTIONS];

const REQUIRED_FIELDS = {
	ai_pin_templates: [
		'owner',
		'name',
		'thumbnail',
		'configuration',
		'is_default',
		'workspace_id',
		'created_by',
		'deleted_at',
		'category',
		'editor_version',
		'schema_version',
		'status',
		'visibility',
		'last_used_at',
		'use_count',
		'variant_group_id',
		'brand_kit',
		'marketplace_meta',
		'template_uuid',
		'config_checksum',
		'revision',
		'created',
		'updated',
	],
	ai_pin_template_versions: [
		'workspace_id',
		'created_by',
		'deleted_at',
		'template_id',
		'version',
		'label',
		'status_snapshot',
		'configuration',
		'thumbnail',
		'checksum',
		'schema_version',
		'created',
		'updated',
	],
	ai_pin_template_assets: [
		'workspace_id',
		'created_by',
		'deleted_at',
		'name',
		'original_name',
		'mime_type',
		'size_bytes',
		'source',
		'file',
		'width',
		'height',
		'created',
		'updated',
	],
	ai_pin_template_favorites: [
		'workspace_id',
		'created_by',
		'deleted_at',
		'template_id',
		'created',
		'updated',
	],
	ai_pin_template_preview_cache: [
		'workspace_id',
		'created_by',
		'deleted_at',
		'template_id',
		'config_checksum',
		'format',
		'image_url',
		'expires_at',
		'created',
		'updated',
	],
};

const INDEX_FRAGMENTS = {
	ai_pin_templates: [
		'idx_ai_pin_templates_workspace',
		'idx_ai_pin_templates_workspace_category',
		'idx_ai_pin_templates_workspace_visibility',
		'idx_ai_pin_templates_workspace_status',
		'idx_ai_pin_templates_workspace_updated',
		'idx_ai_pin_templates_workspace_last_used',
		'idx_ai_pin_templates_variant_group',
		'idx_ai_pin_templates_owner',
		'idx_ai_pin_templates_template_uuid',
		'idx_ai_pin_templates_config_checksum',
		'idx_ai_pin_templates_workspace_category_status',
		'idx_ai_pin_templates_workspace_visibility_updated',
	],
	ai_pin_template_versions: [
		'idx_ai_pin_template_versions_template_version',
		'idx_ai_pin_template_versions_workspace',
		'idx_ai_pin_template_versions_workspace_template',
		'idx_ai_pin_template_versions_workspace_updated',
	],
	ai_pin_template_assets: [
		'idx_ai_pin_template_assets_workspace',
		'idx_ai_pin_template_assets_workspace_updated',
		'idx_ai_pin_template_assets_workspace_source',
	],
	ai_pin_template_favorites: [
		'idx_ai_pin_template_favorites_unique',
		'idx_ai_pin_template_favorites_workspace_user',
		'idx_ai_pin_template_favorites_template',
	],
	ai_pin_template_preview_cache: [
		'idx_ai_pin_template_preview_cache_lookup',
		'idx_ai_pin_template_preview_cache_workspace_expires',
	],
};

function fieldNames(collection) {
	const raw = collection?.fields || collection?.schema || [];
	return new Set((Array.isArray(raw) ? raw : []).map((f) => f?.name).filter(Boolean));
}

function selectValues(collection, fieldName) {
	const raw = collection?.fields || collection?.schema || [];
	const field = (Array.isArray(raw) ? raw : []).find((f) => f?.name === fieldName);
	return Array.isArray(field?.values) ? field.values : [];
}

function indexBlob(collection) {
	return Array.isArray(collection?.indexes) ? collection.indexes.join('\n') : '';
}

async function main() {
	const url = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
	const email = process.env.POCKETBASE_ADMIN_EMAIL || process.env.PB_ADMIN_EMAIL;
	const password = process.env.POCKETBASE_ADMIN_PASSWORD || process.env.PB_ADMIN_PASSWORD;

	if (!email || !password) {
		console.error('Missing POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD');
		process.exit(2);
	}

	const pb = new PocketBase(url);
	await pb.admins.authWithPassword(email, password);

	const errors = [];
	const warnings = [];
	const byName = {};

	for (const name of EXPECTED_COLLECTIONS) {
		try {
			byName[name] = await pb.collections.getOne(name);
		} catch (err) {
			errors.push(`Missing collection: ${name} (${err?.message || err})`);
		}
	}

	for (const [name, required] of Object.entries(REQUIRED_FIELDS)) {
		const col = byName[name];
		if (!col) continue;

		const present = fieldNames(col);
		const missing = required.filter((f) => !present.has(f));
		if (missing.length) {
			errors.push(`${name} missing fields: ${missing.join(', ')}`);
		}

		const blob = indexBlob(col);
		for (const frag of INDEX_FRAGMENTS[name] || []) {
			if (!blob.includes(frag)) {
				errors.push(`${name} missing index fragment: ${frag}`);
			}
		}
	}

	const templates = byName.ai_pin_templates;
	if (templates) {
		const present = fieldNames(templates);
		for (const v1 of ['owner', 'name', 'thumbnail', 'configuration', 'is_default']) {
			if (!present.has(v1)) {
				errors.push(`BREAKING: ai_pin_templates lost v1 field ${v1}`);
			}
		}

		const checks = [
			['category', TEMPLATE_CATEGORIES],
			['status', TEMPLATE_STATUS],
			['visibility', TEMPLATE_VISIBILITY],
		];
		for (const [field, expected] of checks) {
			const values = selectValues(templates, field);
			for (const v of expected) {
				if (!values.includes(v)) {
					warnings.push(`${field} select missing value: ${v}`);
				}
			}
		}
	}

	try {
		await pb.collection('ai_pin_templates').getList(1, 1);
	} catch (err) {
		errors.push(`ai_pin_templates list failed: ${err?.message || err}`);
	}

	console.log('\n=== Template Engine Module 1 schema verification ===');
	console.log(`PocketBase: ${url}`);
	console.log(`Collections: ${EXPECTED_COLLECTIONS.join(', ')}`);
	if (warnings.length) {
		console.log('\nWarnings:');
		for (const w of warnings) console.log(`  - ${w}`);
	}
	if (errors.length) {
		console.log('\nFAILED:');
		for (const e of errors) console.log(`  - ${e}`);
		process.exit(1);
	}
	console.log('\nOK — schema matches Module 1 expectations.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
