import { Router } from 'express';
import healthCheck from './health-check.js';
import integratedAiRouter from './integrated-ai.js';
import { pocketbaseAuth } from '../middleware/pocketbase-auth.js';
import { attachWorkspace, requireWorkspaceRead } from '../middleware/product-access.js';
import websitesRouter from './websites.js';
import wordpressRouter from './wordpress/index.js';
import pinterestRouter from './pinterest.js';
import settingsRouter from './settings.js';
import aiPinImagesRouter from './ai-pin-images.js';
import aiPinGenerationRouter from './ai-pin-generation.js';
import aiPinsRouter from './ai-pins.js';
import adminRouter from './admin/index.js';
import workspaceRouter from './workspace/index.js';
import legalRouter from './legal.js';

const router = Router();

export default () => {
    router.get('/health', healthCheck);
    router.get('/api/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
        });
    });
    router.use('/legal', legalRouter);
    router.use('/integrated-ai', integratedAiRouter);
    router.use('/websites', pocketbaseAuth, attachWorkspace, requireWorkspaceRead, websitesRouter);
    router.use('/wordpress', wordpressRouter);
    router.use('/pinterest', pinterestRouter);
    router.use('/settings', settingsRouter);
    router.use('/ai-pin-images', pocketbaseAuth, attachWorkspace, requireWorkspaceRead, aiPinImagesRouter);
    router.use('/ai-pin-images/generation', pocketbaseAuth, attachWorkspace, requireWorkspaceRead, aiPinGenerationRouter);
    router.use('/ai-pins', pocketbaseAuth, attachWorkspace, requireWorkspaceRead, aiPinsRouter);
    router.use('/workspace/v1', workspaceRouter);
    router.use('/admin/v1', adminRouter);

    return router;
};

