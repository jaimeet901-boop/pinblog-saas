import { getPinterestQueueStatus } from '../services/pinterest-publish-queue.js';
import { getAIPinImageQueueStatus } from '../services/ai-pin-image-queue.js';
import { getEnv } from '../utils/env.js';
import { getCache, setCache } from '../utils/cache.js';

const PB_BASE_URL = getEnv('PB_BASE_URL', 'http://localhost:8090');
const PB_HEALTH_CACHE_KEY = 'health:pocketbase';
const PB_HEALTH_CACHE_TTL_MS = 5000;

async function getPocketBaseStatus() {
    const cached = getCache(PB_HEALTH_CACHE_KEY);
    if (cached) {
        return cached;
    }

    try {
        const response = await fetch(`${PB_BASE_URL}/api/health`, { method: 'HEAD' });
        const payload = {
            status: response.ok ? 'up' : 'down',
            ok: response.ok,
        };
        setCache(PB_HEALTH_CACHE_KEY, payload, PB_HEALTH_CACHE_TTL_MS);
        return payload;
    } catch {
        const payload = {
            status: 'down',
            ok: false,
        };
        setCache(PB_HEALTH_CACHE_KEY, payload, PB_HEALTH_CACHE_TTL_MS);
        return payload;
    }
}

function getRedisStatus() {
    if (!process.env.REDIS_URL) {
        return {
            status: 'not_configured',
            ok: true,
        };
    }

    return {
        status: 'configured_unchecked',
        ok: true,
    };
}

export default async (req, res) => {
    const [database, redis] = await Promise.all([
        getPocketBaseStatus(),
        Promise.resolve(getRedisStatus()),
    ]);

    const queue = getPinterestQueueStatus();
    const imageQueue = getAIPinImageQueueStatus();
    const ok = database.ok && redis.ok;

    res.status(ok ? 200 : 503).json({
        status: ok ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        services: {
            database,
            redis,
            queue,
            imageQueue,
        },
    });
};
