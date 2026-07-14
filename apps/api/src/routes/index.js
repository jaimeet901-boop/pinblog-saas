import { Router } from 'express';
import healthCheck from './health-check.js';
import integratedAiRouter from './integrated-ai.js';
import { pocketbaseAuth } from '../middleware/pocketbase-auth.js';
import websitesRouter from './websites.js';
import wordpress from './wordpress.js';
import wordpressPublish from './wordpress-publish.js';
import pinterestRouter from './pinterest.js';
import settingsRouter from './settings.js';
import aiPinImagesRouter from './ai-pin-images.js';

const router = Router();

export default () => {
    router.get('/health', healthCheck);
    router.use('/integrated-ai', integratedAiRouter);
    router.use('/websites', pocketbaseAuth, websitesRouter);
    router.post('/wordpress/test', pocketbaseAuth, wordpress);
    router.post('/wordpress/publish', pocketbaseAuth, wordpressPublish);
    router.use('/pinterest', pinterestRouter);
    router.use('/settings', settingsRouter);
    router.use('/ai-pin-images', aiPinImagesRouter);

    return router;
};

