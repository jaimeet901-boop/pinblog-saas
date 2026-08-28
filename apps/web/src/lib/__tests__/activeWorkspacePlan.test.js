/**
 * Sidebar plan display — active workspace, not users.plan.
 * Run: npm test --prefix apps/web -- src/lib/__tests__/activeWorkspacePlan.test.js
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	formatActiveWorkspacePlanLabel,
	isActiveWorkspaceOnFreePlan,
	resolveActiveWorkspacePlanSlug,
} from '../activeWorkspacePlan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const layoutSource = readFileSync(path.resolve(here, '../../components/AppLayout.jsx'), 'utf8');
const bannerSource = readFileSync(path.resolve(here, '../../components/FreePlanUpgradeBanner.jsx'), 'utf8');

describe('formatActiveWorkspacePlanLabel', () => {
	it('active workspace Starter → displays "Starter Plan"', () => {
		assert.equal(
			formatActiveWorkspacePlanLabel({ planName: 'Starter', planSlug: 'starter' }),
			'Starter Plan',
		);
	});

	it('active workspace Free → displays "Free Plan"', () => {
		assert.equal(
			formatActiveWorkspacePlanLabel({ planName: 'Free', planSlug: 'free' }),
			'Free Plan',
		);
	});

	it('user.plan = "free" while activeWorkspace = "starter" → displays "Starter Plan"', () => {
		const user = { plan: 'free' };
		const activeWorkspace = { planName: 'Starter', planSlug: 'starter' };
		assert.equal(user.plan, 'free');
		assert.equal(formatActiveWorkspacePlanLabel(activeWorkspace), 'Starter Plan');
		assert.equal(resolveActiveWorkspacePlanSlug(activeWorkspace), 'starter');
	});

	it('workspace switching updates the displayed plan', () => {
		const starter = { id: 'ws-starter', planName: 'Starter', planSlug: 'starter' };
		const free = { id: 'ws-free', planName: 'Free', planSlug: 'free' };
		assert.equal(formatActiveWorkspacePlanLabel(starter), 'Starter Plan');
		assert.equal(formatActiveWorkspacePlanLabel(free), 'Free Plan');
		assert.equal(isActiveWorkspaceOnFreePlan(starter), false);
		assert.equal(isActiveWorkspaceOnFreePlan(free), true);
	});

	it('no active workspace → safe fallback without crashing', () => {
		assert.equal(formatActiveWorkspacePlanLabel(null), 'Free Plan');
		assert.equal(formatActiveWorkspacePlanLabel(undefined), 'Free Plan');
		assert.equal(formatActiveWorkspacePlanLabel({}), 'Free Plan');
		assert.equal(isActiveWorkspaceOnFreePlan(null), false);
		assert.equal(isActiveWorkspaceOnFreePlan(undefined), false);
		assert.doesNotThrow(() => formatActiveWorkspacePlanLabel(null));
	});

	it('slug-only starter still displays "Starter Plan"', () => {
		assert.equal(formatActiveWorkspacePlanLabel({ planSlug: 'starter' }), 'Starter Plan');
	});
});

describe('wiring: AppLayout UserCard and FreePlanUpgradeBanner', () => {
	it('UserCard uses active workspace plan helper, not user.plan', () => {
		assert.match(layoutSource, /useWorkspace/);
		assert.match(layoutSource, /formatActiveWorkspacePlanLabel/);
		assert.doesNotMatch(
			layoutSource,
			/user\?\.plan \|\| 'free'/,
		);
	});

	it('FreePlanUpgradeBanner uses active workspace plan, not user.plan', () => {
		assert.match(bannerSource, /useWorkspace/);
		assert.match(bannerSource, /isActiveWorkspaceOnFreePlan/);
		assert.doesNotMatch(bannerSource, /user\?\.plan/);
		assert.doesNotMatch(bannerSource, /useAuth/);
	});
});
