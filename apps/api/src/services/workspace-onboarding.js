import pocketbaseClient from '../utils/pocketbaseClient.js';
import { assertCapability } from './workspace-rbac.js';
import { auditFromRequest } from './workspace-audit.js';
import { countWorkspaceResources } from './workspace-ownership.js';

export const ONBOARDING_STEPS = [
	{ id: 'create_workspace', label: 'Create Workspace', to: '/app/settings' },
	{ id: 'connect_wordpress', label: 'Connect WordPress', to: '/app/websites' },
	{ id: 'connect_pinterest', label: 'Connect Pinterest', to: '/app/pinterest' },
	{ id: 'choose_ai', label: 'Choose AI Provider', to: '/app/settings' },
	{ id: 'select_template', label: 'Select Template', to: '/app/ai-pins' },
	{ id: 'generate_article', label: 'Generate First Article', to: '/app/writer' },
	{ id: 'generate_pin', label: 'Generate First Pin', to: '/app/ai-pins' },
	{ id: 'invite_team', label: 'Invite Team', to: '/app/settings' },
	{ id: 'finish_setup', label: 'Finish Setup', to: '/app' },
];

function defaultSteps() {
	return Object.fromEntries(ONBOARDING_STEPS.map((step) => [step.id, { done: false, skipped: false, at: null }]));
}

function computePercent(steps = {}, skippedAll = false) {
	if (skippedAll) return 100;
	const ids = ONBOARDING_STEPS.map((step) => step.id);
	const doneCount = ids.filter((id) => steps[id]?.done || steps[id]?.skipped).length;
	return Math.round((doneCount / ids.length) * 100);
}

async function loadRow(workspaceId) {
	try {
		return await pocketbaseClient.collection('workspace_onboarding').getFirstListItem(
			pocketbaseClient.filter('workspace = {:ws}', { ws: workspaceId }),
			{ requestKey: null },
		);
	} catch {
		return null;
	}
}

async function detectAutoSteps(req) {
	const [websites, pinterest, articles, pins, members, providers, templates] = await Promise.all([
		countWorkspaceResources('websites', req),
		countWorkspaceResources('pinterest_accounts', req),
		countWorkspaceResources('articles', req),
		countWorkspaceResources('ai_pins', req).catch(() => countWorkspaceResources('pins', req)),
		pocketbaseClient.collection('workspace_members').getFullList({
			filter: pocketbaseClient.filter('workspace = {:ws} && status != "removed" && role != "owner"', {
				ws: req.workspace.id,
			}),
			fields: 'id,status',
			requestKey: null,
		}).catch(() => []),
		pocketbaseClient.collection('ai_providers').getList(1, 1, {
			filter: 'enabled = true',
			requestKey: null,
		}).then((r) => r.totalItems || 0).catch(() => 0),
		countWorkspaceResources('ai_pin_templates', req).catch(() => 0),
	]);

	return {
		create_workspace: true,
		connect_wordpress: websites > 0,
		connect_pinterest: pinterest > 0,
		choose_ai: providers > 0,
		select_template: templates > 0,
		generate_article: articles > 0,
		generate_pin: pins > 0,
		invite_team: members.length > 0,
	};
}

function mapDto(row, auto = {}) {
	const steps = { ...defaultSteps(), ...(row?.steps && typeof row.steps === 'object' ? row.steps : {}) };
	for (const [id, done] of Object.entries(auto)) {
		if (done && !steps[id]?.done) {
			steps[id] = { done: true, skipped: Boolean(steps[id]?.skipped), at: steps[id]?.at || new Date().toISOString(), auto: true };
		}
	}
	const skipped = Boolean(row?.skipped);
	const percent = computePercent(steps, skipped);
	const catalog = ONBOARDING_STEPS.map((step) => ({
		...step,
		done: Boolean(steps[step.id]?.done),
		skipped: Boolean(steps[step.id]?.skipped),
		at: steps[step.id]?.at || null,
	}));
	const next = catalog.find((step) => !step.done && !step.skipped) || null;
	return {
		workspaceId: row?.workspace || '',
		steps: catalog,
		stepState: steps,
		completedPercent: percent,
		skipped,
		completedAt: row?.completed_at || (percent >= 100 ? row?.updated : null),
		finished: skipped || percent >= 100,
		nextStep: next,
	};
}

export async function getWorkspaceOnboarding(req) {
	assertCapability(req, 'workspace.read');
	let row = await loadRow(req.workspace.id);
	if (!row) {
		row = await pocketbaseClient.collection('workspace_onboarding').create({
			workspace: req.workspace.id,
			steps: defaultSteps(),
			completed_percent: 0,
			skipped: false,
			updated_by: req.pocketbaseUserId,
		}).catch(() => null);
	}
	const auto = await detectAutoSteps(req);
	const dto = mapDto(row, auto);

	// Persist auto-detected progress
	if (row?.id) {
		const nextPercent = dto.completedPercent;
		await pocketbaseClient.collection('workspace_onboarding').update(row.id, {
			steps: dto.stepState,
			completed_percent: nextPercent,
			completed_at: dto.finished && !row.completed_at ? new Date().toISOString() : row.completed_at,
			updated_by: req.pocketbaseUserId,
		}).catch(() => null);
		if (dto.finished) {
			pocketbaseClient.collection('workspaces').update(req.workspace.id, {
				onboarding_completed: true,
			}).catch(() => null);
		}
	}

	return dto;
}

export async function updateWorkspaceOnboarding(req, payload = {}) {
	assertCapability(req, 'workspace.settings.manage');
	let row = await loadRow(req.workspace.id);
	if (!row) {
		row = await pocketbaseClient.collection('workspace_onboarding').create({
			workspace: req.workspace.id,
			steps: defaultSteps(),
			completed_percent: 0,
			skipped: false,
			updated_by: req.pocketbaseUserId,
		});
	}

	const steps = { ...defaultSteps(), ...(row.steps && typeof row.steps === 'object' ? row.steps : {}) };
	const updates = { updated_by: req.pocketbaseUserId };

	if (payload.skipAll === true || payload.skipped === true) {
		updates.skipped = true;
		updates.completed_at = new Date().toISOString();
		for (const step of ONBOARDING_STEPS) {
			if (!steps[step.id]?.done) {
				steps[step.id] = { done: false, skipped: true, at: new Date().toISOString() };
			}
		}
	}

	if (payload.stepId) {
		const stepId = String(payload.stepId);
		if (!ONBOARDING_STEPS.some((step) => step.id === stepId)) {
			const { httpError } = await import('../middleware/require-admin.js');
			throw httpError(422, 'Unknown onboarding step', 'VALIDATION_ERROR');
		}
		steps[stepId] = {
			done: payload.done !== false,
			skipped: Boolean(payload.skip),
			at: new Date().toISOString(),
		};
	}

	if (Array.isArray(payload.completeSteps)) {
		for (const stepId of payload.completeSteps) {
			if (ONBOARDING_STEPS.some((step) => step.id === stepId)) {
				steps[stepId] = { done: true, skipped: false, at: new Date().toISOString() };
			}
		}
	}

	const percent = computePercent(steps, Boolean(updates.skipped ?? row.skipped));
	updates.steps = steps;
	updates.completed_percent = percent;
	if (percent >= 100 && !row.completed_at) {
		updates.completed_at = new Date().toISOString();
	}

	const updated = await pocketbaseClient.collection('workspace_onboarding').update(row.id, updates);
	if (percent >= 100 || updates.skipped) {
		await pocketbaseClient.collection('workspaces').update(req.workspace.id, {
			onboarding_completed: true,
		}).catch(() => null);
	}

	await auditFromRequest(req, {
		action: 'updated',
		title: 'Onboarding progress updated',
		summary: `Completion ${percent}%`,
		resourceType: 'workspace_onboarding',
		resourceId: updated.id,
		meta: { percent, skipped: Boolean(updated.skipped) },
	});

	return mapDto(updated);
}
