const cache = new Map();

export function getCache(key) {
	const item = cache.get(key);
	if (!item) {
		return null;
	}

	if (item.expiresAt <= Date.now()) {
		cache.delete(key);
		return null;
	}

	return item.value;
}

export function setCache(key, value, ttlMs) {
	cache.set(key, {
		value,
		expiresAt: Date.now() + Math.max(0, ttlMs),
	});
}

export function invalidateCacheByPrefix(prefix) {
	for (const key of cache.keys()) {
		if (key.startsWith(prefix)) {
			cache.delete(key);
		}
	}
}
