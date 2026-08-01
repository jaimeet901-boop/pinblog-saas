import test from 'node:test';
import assert from 'node:assert/strict';
import {
	AUTH_OAUTH2_MAPPED_FIELDS,
	normalizeAuthOAuth2MappedFields,
} from './oauth2-mapped-fields.js';

test('default mapped fields never bind provider id to record primary key', () => {
	assert.equal(AUTH_OAUTH2_MAPPED_FIELDS.id, '');
	assert.equal(AUTH_OAUTH2_MAPPED_FIELDS.name, 'name');
	assert.equal(AUTH_OAUTH2_MAPPED_FIELDS.avatarURL, 'avatar');
});

test('normalize clears dangerous id → id mapping from prior config', () => {
	const fixed = normalizeAuthOAuth2MappedFields({
		id: 'id',
		name: 'name',
		username: 'username',
		avatarURL: 'avatarURL',
	});
	assert.equal(fixed.id, '');
	assert.equal(fixed.name, 'name');
	assert.equal(fixed.avatarURL, 'avatar');
});

test('normalize keeps safe custom name mapping', () => {
	const fixed = normalizeAuthOAuth2MappedFields({
		id: 'id',
		name: 'display_name',
	});
	assert.equal(fixed.id, '');
	assert.equal(fixed.name, 'display_name');
});
