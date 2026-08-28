/**
 * Phase 1 rebrand — platform / invite / mail / members / config fallbacks.
 * Run: node --test src/services/rebrand-phase1-defaults.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('Phase 1 customer-facing defaults', () => {
	it('platform-settings defaults use Seodeva', () => {
		const src = readFileSync(path.join(here, 'platform-settings.js'), 'utf8');
		assert.match(src, /platformName:\s*'Seodeva'/);
		assert.match(src, /supportEmail:\s*'contact@seodeva\.com'/);
		assert.match(src, /senderName:\s*'Seodeva'/);
		assert.match(src, /senderEmail:\s*'contact@seodeva\.com'/);
		assert.doesNotMatch(src, /platformName:\s*'Chef IA'/);
		assert.doesNotMatch(src, /chef-ia\.example/);
		assert.doesNotMatch(src, /\|\|\s*'Chef IA'/);
	});

	it('invite / pocketbase-mail / members / config fallbacks are Seodeva', () => {
		const invite = readFileSync(path.join(here, 'workspace-invite-mail.js'), 'utf8');
		assert.match(invite, /FALLBACK_PLATFORM_NAME = 'Seodeva'/);
		assert.match(invite, /FALLBACK_APP_URL = 'https:\/\/seodeva\.com'/);
		assert.match(invite, /FALLBACK_SUPPORT_EMAIL = 'contact@seodeva\.com'/);
		assert.doesNotMatch(invite, /Chef IA|tbuy\.store/);

		const pbMail = readFileSync(path.join(here, 'pocketbase-mail.js'), 'utf8');
		assert.match(pbMail, /senderName \|\| 'Seodeva'/);
		assert.doesNotMatch(pbMail, /'Chef IA'/);

		const members = readFileSync(path.join(here, 'workspace-members.js'), 'utf8');
		assert.match(members, /platformName \|\| 'Seodeva'/);
		assert.doesNotMatch(members, /'Chef IA'/);

		const config = readFileSync(path.join(here, 'workspace-config.js'), 'utf8');
		assert.match(config, /platformName \|\| 'Seodeva'/);
		assert.doesNotMatch(config, /platformName \|\| 'Chef IA'/);
	});
});
