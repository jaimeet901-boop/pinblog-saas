/**
 * Pin Generation API routes — lifecycle for orchestration runs.
 * Mounted under /ai-pin-images/generation/*
 */

import { Router } from 'express';
import {
	createGenerationRun,
	getGenerationRun,
	listGenerationRuns,
	advanceGenerationRun,
	completeGenerationRun,
	failGenerationRun,
	cancelGenerationRun,
	retryGenerationRun,
	linkImageJobToRun,
	createGenerationBatch,
	loadTemplateSnapshotReadOnly,
} from '../services/pin-generation.js';
import {
	PIN_GENERATION_STAGES,
	PIN_GENERATION_STAGE_PROGRESS,
	PIN_GENERATION_IMAGE_MODES,
} from '../constants/pin-generation.js';

const router = Router();

router.get('/meta', (_req, res) => {
	res.json({
		stages: PIN_GENERATION_STAGES,
		progress: PIN_GENERATION_STAGE_PROGRESS,
		imageModes: PIN_GENERATION_IMAGE_MODES,
		pipeline: [
			'Content',
			'Variables',
			'AI Image',
			'Template Engine (read-only clone)',
			'Renderer',
			'Export Engine',
			'Final Pin',
		],
		extensions: ['batch', 'ab_variants', 'multi_language', 'scheduled', 'team_workspaces'],
		notes: {
			templatesReadOnly: true,
			metadataCollection: 'ai_pin_generation_runs',
			usesAiGeneration: true,
			usesExportEngine: true,
		},
	});
});

router.get('/runs', async (req, res) => {
	res.json(await listGenerationRuns(req, req.query));
});

router.post('/runs', async (req, res) => {
	res.status(201).json({ run: await createGenerationRun(req, req.body || {}) });
});

router.post('/batch', async (req, res) => {
	res.status(201).json(await createGenerationBatch(req, req.body || {}));
});

router.get('/runs/:id', async (req, res) => {
	res.json({ run: await getGenerationRun(req, req.params.id) });
});

router.post('/runs/:id/advance', async (req, res) => {
	res.json({ run: await advanceGenerationRun(req, req.params.id, req.body || {}) });
});

router.post('/runs/:id/complete', async (req, res) => {
	res.json({ run: await completeGenerationRun(req, req.params.id, req.body || {}) });
});

router.post('/runs/:id/fail', async (req, res) => {
	res.json({ run: await failGenerationRun(req, req.params.id, req.body || {}) });
});

router.post('/runs/:id/cancel', async (req, res) => {
	res.json({ run: await cancelGenerationRun(req, req.params.id) });
});

router.post('/runs/:id/retry', async (req, res) => {
	res.json({ run: await retryGenerationRun(req, req.params.id) });
});

router.post('/runs/:id/link-image-job', async (req, res) => {
	const imageJobId = String(req.body?.imageJobId || '').trim();
	if (!imageJobId) {
		return res.status(422).json({ message: 'imageJobId required' });
	}
	res.json({ run: await linkImageJobToRun(req, req.params.id, imageJobId) });
});

router.get('/templates/:id/snapshot', async (req, res) => {
	const snapshot = await loadTemplateSnapshotReadOnly(req, req.params.id);
	res.json({ snapshot, readOnly: true });
});

export default router;
