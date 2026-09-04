import { Router } from 'express';
import healthCheck from './health-check.js';
import integratedAiRouter from './integrated-ai.js';
import { pocketbaseAuth } from '../middleware/pocketbase-auth.js';
import { attachWorkspace, requireWorkspaceRead, requireWorkspaceMutation } from '../middleware/product-access.js';
import websitesRouter from './websites.js';
import wordpressRouter from './wordpress/index.js';
import pinterestRouter from './pinterest.js';
import facebookRouter from './facebook.js';
import settingsRouter from './settings.js';
import aiPinImagesRouter from './ai-pin-images.js';
import aiPinGenerationRouter from './ai-pin-generation.js';
import aiPinsRouter from './ai-pins.js';
import adminRouter from './admin/index.js';
import workspaceRouter from './workspace/index.js';
import legalRouter from './legal.js';
import platformIdentityRouter from './platform-identity.js';
import publicPlansRouter from './public-plans.js';
import billingRouter from './billing.js';
import tenantContentRouter from './tenant-content.js';
import publishingRouter from './publishing.js';
import writerArticleImagesRouter from './writer-article-images.js';

const router = Router();

export default () => {
    router.get('/health', healthCheck);
    router.get('/api/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
        });
    });
    router.use('/legal', legalRouter);
    router.use('/platform/identity', platformIdentityRouter);
    router.use('/public/plans', publicPlansRouter);
    router.use('/billing', billingRouter);
    router.use('/integrated-ai', integratedAiRouter);
    router.use('/writer-article-images', writerArticleImagesRouter);
    router.use('/websites', pocketbaseAuth, attachWorkspace, requireWorkspaceRead, requireWorkspaceMutation('workspace.websites.manage'), websitesRouter);
    router.use('/wordpress', wordpressRouter);
    router.use('/pinterest', pinterestRouter);
    router.use('/facebook', facebookRouter);
    router.use('/publishing', pocketbaseAuth, attachWorkspace, requireWorkspaceRead, publishingRouter);
    router.use('/settings', settingsRouter);
    router.use('/ai-pin-images', pocketbaseAuth, attachWorkspace, requireWorkspaceRead, requireWorkspaceMutation('workspace.ai.generate'), aiPinImagesRouter);
    router.use('/ai-pin-images/generation', pocketbaseAuth, attachWorkspace, requireWorkspaceRead, requireWorkspaceMutation('workspace.ai.generate'), aiPinGenerationRouter);
    router.use('/ai-pins', pocketbaseAuth, attachWorkspace, requireWorkspaceRead, requireWorkspaceMutation('workspace.ai.generate'), aiPinsRouter);
    router.use('/content', pocketbaseAuth, attachWorkspace, requireWorkspaceRead, requireWorkspaceMutation(['workspace.ai.generate', 'workspace.websites.manage']), tenantContentRouter);
    router.use('/workspace/v1', workspaceRouter);
    router.use('/admin/v1', adminRouter);

    return router;
};

