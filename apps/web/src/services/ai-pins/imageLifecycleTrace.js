/**
 * End-to-end image lifecycle tracer for AI Pins compose/upload/preview.
 * Logs every stage with URL, dimensions, success/failure, and value changes.
 */

function callerFrame(depth = 3) {
	try {
		const stack = String(new Error().stack || '').split('\n');
		const line = stack[depth] || stack[2] || '';
		const match = line.match(/(?:at\s+)?(?:(.+?)\s+\()?((?:file:\/\/|https?:\/\/|\/|[A-Za-z]:\\).+?):(\d+):(\d+)/)
			|| line.match(/([^(\s]+) \((.+):(\d+):(\d+)\)/);
		if (!match) {
			return { functionName: 'unknown', fileName: line.trim().slice(0, 180), lineNumber: 0 };
		}
		return {
			functionName: String(match[1] || 'anonymous').trim() || 'anonymous',
			fileName: String(match[2] || '').replace(/^.*\/(apps\/web\/)/, '$1'),
			lineNumber: Number(match[3]) || 0,
		};
	} catch {
		return { functionName: 'unknown', fileName: '', lineNumber: 0 };
	}
}

async function sampleBlobVariance(blob) {
	if (!blob || typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
		return { width: 0, height: 0, variance: null, nonDarkRatio: null };
	}
	try {
		const bitmap = await createImageBitmap(blob);
		const canvas = document.createElement('canvas');
		const w = Math.min(64, bitmap.width || 0);
		const h = Math.min(64, bitmap.height || 0);
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx || !w || !h) {
			bitmap.close?.();
			return { width: bitmap.width || 0, height: bitmap.height || 0, variance: null, nonDarkRatio: null };
		}
		ctx.drawImage(bitmap, 0, 0, w, h);
		const { data } = ctx.getImageData(0, 0, w, h);
		let sum = 0;
		let sumSq = 0;
		let nonDark = 0;
		const n = w * h;
		for (let i = 0; i < data.length; i += 4) {
			const y = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
			sum += y;
			sumSq += y * y;
			if (y > 18) nonDark += 1;
		}
		bitmap.close?.();
		const mean = sum / n;
		const variance = (sumSq / n) - (mean * mean);
		return {
			width: bitmap.width,
			height: bitmap.height,
			variance: Number(variance.toFixed(2)),
			nonDarkRatio: Number((nonDark / n).toFixed(4)),
			looksBlank: variance < 25 && (nonDark / n) < 0.02,
		};
	} catch {
		return { width: 0, height: 0, variance: null, nonDarkRatio: null, looksBlank: null };
	}
}

const lastByKey = new Map();

export async function traceImageLifecycle(stage, payload = {}) {
	const at = new Date().toISOString();
	const where = callerFrame(payload.stackDepth || 3);
	const key = String(payload.traceId || payload.tempId || payload.articleId || 'global');
	const url = String(payload.imageUrl || payload.url || payload.featuredImageUrl || '').trim();
	const prev = lastByKey.get(key) || null;
	const changed = Boolean(prev && prev.url !== url);

	let dimensions = payload.dimensions || null;
	let content = payload.content || null;
	if (payload.blob && (!content || payload.sampleBlob)) {
		content = await sampleBlobVariance(payload.blob);
		dimensions = dimensions || { width: content.width, height: content.height };
	}

	const entry = {
		stage: String(stage),
		timestamp: at,
		success: payload.success !== false && !payload.error,
		failure: payload.error ? String(payload.error) : null,
		imageUrl: url ? url.slice(0, 220) : '',
		dimensions,
		content,
		changed,
		previousValue: changed ? (prev?.url || '').slice(0, 220) : undefined,
		newValue: changed ? url.slice(0, 220) : undefined,
		functionName: payload.functionName || where.functionName,
		fileName: payload.fileName || where.fileName,
		lineNumber: payload.lineNumber || where.lineNumber,
		meta: payload.meta || undefined,
	};

	lastByKey.set(key, { url, at, stage });
	// Single-line JSON for easy filtering in DevTools.
	console.info(`[image-lifecycle] ${JSON.stringify(entry)}`);
	return entry;
}

export function resetImageLifecycleTrace(traceId = '') {
	if (!traceId) {
		lastByKey.clear();
		return;
	}
	lastByKey.delete(String(traceId));
}
