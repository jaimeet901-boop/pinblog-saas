/**
 * Production-grade featured-image proxy fetch.
 * Browser-like headers, SSRF-safe redirects, streaming with size limits,
 * MIME/magic validation, and structured diagnostics for every failure mode.
 */

import dns from 'node:dns/promises';
import net from 'node:net';
import { assertSafePublicHttpUrl, isPrivateHostname } from '../utils/ssrf-guard.js';
import logger from '../utils/logger.js';

export const FEATURED_IMAGE_PROXY_MAX_BYTES = 12 * 1024 * 1024;
export const FEATURED_IMAGE_PROXY_TIMEOUT_MS = 20_000;
export const FEATURED_IMAGE_PROXY_MAX_REDIRECTS = 5;

const BROWSER_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const ACCEPT_IMAGE =
	'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const ALLOWED_IMAGE_MIME_PREFIXES = [
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/webp',
	'image/avif',
	'image/gif',
	'image/bmp',
	'image/x-icon',
	'image/vnd.microsoft.icon',
	'image/svg+xml',
];

function proxyError(status, message, errorCode, diagnostics = null, cause = null) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	error.diagnostics = diagnostics;
	if (cause) error.cause = cause;
	return error;
}

function nowMs() {
	return Date.now();
}

function cancelResponseBody(response) {
	try {
		const cancel = response?.body?.cancel;
		if (typeof cancel === 'function') {
			cancel.call(response.body).catch(() => null);
		}
	} catch {
		// ignore — best-effort cleanup
	}
}

function waitForWritableDrain(res) {
	return new Promise((resolve, reject) => {
		if (res.writableEnded || res.destroyed) {
			resolve();
			return;
		}
		const onDrain = () => {
			cleanup();
			resolve();
		};
		const onClose = () => {
			cleanup();
			resolve();
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		function cleanup() {
			res.off?.('drain', onDrain);
			res.off?.('close', onClose);
			res.off?.('error', onError);
			res.removeListener?.('drain', onDrain);
			res.removeListener?.('close', onClose);
			res.removeListener?.('error', onError);
		}
		res.once('drain', onDrain);
		res.once('close', onClose);
		res.once('error', onError);
	});
}

function headersToObject(headers) {
	const out = {};
	if (!headers || typeof headers.forEach !== 'function') return out;
	headers.forEach((value, key) => {
		out[String(key).toLowerCase()] = String(value);
	});
	return out;
}

function classifyFetchFailure(error) {
	const message = String(error?.message || error || '');
	const code = String(error?.cause?.code || error?.code || '');
	const name = String(error?.name || '');

	if (name === 'AbortError' || code === 'ABORT_ERR' || /aborted/i.test(message)) {
		return { errorCode: 'PROXY_TIMEOUT', status: 504, message: 'Featured image download timed out' };
	}
	if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo|ENOTFOUND|DNS/i.test(message)) {
		return { errorCode: 'PROXY_DNS_FAILED', status: 502, message: 'DNS lookup failed for image host' };
	}
	if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE') {
		return { errorCode: 'PROXY_CONNECTION_FAILED', status: 502, message: `Connection to image host failed (${code || 'network'})` };
	}
	if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
		return { errorCode: 'PROXY_TIMEOUT', status: 504, message: 'Connection to image host timed out' };
	}
	if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || /certificate|TLS|SSL/i.test(message)) {
		return { errorCode: 'PROXY_TLS_FAILED', status: 502, message: 'TLS handshake failed for image host' };
	}
	if (error?.status && error?.errorCode) {
		return { errorCode: error.errorCode, status: error.status, message: error.message };
	}
	return { errorCode: 'PROXY_FETCH_FAILED', status: 502, message: message || 'Failed to fetch featured image' };
}

function parseContentType(headerValue) {
	const raw = String(headerValue || '').split(';')[0].trim().toLowerCase();
	return raw;
}

function isDisallowedDocumentMime(mime) {
	if (!mime) return false;
	return (
		mime.startsWith('text/html')
		|| mime === 'application/json'
		|| mime.startsWith('application/xml')
		|| mime.startsWith('text/xml')
		|| mime.startsWith('application/xhtml')
		|| mime.startsWith('text/plain')
	);
}

function isAllowedImageMime(mime) {
	if (!mime) return false;
	if (mime === 'application/octet-stream') return true;
	return ALLOWED_IMAGE_MIME_PREFIXES.some((prefix) => mime === prefix || mime.startsWith(`${prefix}`))
		|| mime.startsWith('image/');
}

function detectImageMagic(bytes) {
	if (!bytes || bytes.length < 3) return null;
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
	if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
	if (
		bytes.length >= 12
		&& bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
		&& bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
	) {
		return 'image/webp';
	}
	// ISO BMFF (AVIF/HEIC): ftyp box
	if (
		bytes.length >= 12
		&& bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
	) {
		const brand = bytes.slice(8, 12).toString('ascii');
		if (brand.startsWith('avif') || brand.startsWith('avis') || brand === 'mif1') return 'image/avif';
	}
	return null;
}

async function assertResolvedHostIsPublic(hostname) {
	const host = String(hostname || '').trim().toLowerCase();
	if (!host) {
		throw proxyError(422, 'Image host is empty', 'SSRF_BLOCKED');
	}
	if (isPrivateHostname(host)) {
		throw proxyError(422, 'Image host is not allowed', 'SSRF_BLOCKED');
	}
	// Literal public IPs skip DNS; private literals already rejected above.
	if (net.isIP(host)) {
		return { hostname: host, addresses: [host], dnsOk: true };
	}

	let records;
	try {
		records = await dns.lookup(host, { all: true, verbatim: true });
	} catch (error) {
		throw proxyError(
			502,
			'DNS lookup failed for image host',
			'PROXY_DNS_FAILED',
			{ hostname: host, dnsError: error?.message || String(error) },
			error,
		);
	}

	const addresses = (records || []).map((row) => row.address).filter(Boolean);
	if (!addresses.length) {
		throw proxyError(502, 'DNS lookup returned no addresses', 'PROXY_DNS_FAILED', { hostname: host });
	}
	for (const address of addresses) {
		if (isPrivateHostname(address)) {
			throw proxyError(
				422,
				'Image host resolves to a private IP and is not allowed',
				'SSRF_BLOCKED',
				{ hostname: host, addresses },
			);
		}
	}
	return { hostname: host, addresses, dnsOk: true };
}

function buildBrowserHeaders(targetUrl, { referer } = {}) {
	let origin = '';
	try {
		origin = new URL(targetUrl).origin;
	} catch {
		origin = '';
	}
	return {
		Accept: ACCEPT_IMAGE,
		'Accept-Language': 'en-US,en;q=0.9',
		// Prefer identity so Content-Length matches the bytes we stream/limit.
		'Accept-Encoding': 'identity',
		'User-Agent': BROWSER_USER_AGENT,
		'Cache-Control': 'no-cache',
		Pragma: 'no-cache',
		...(referer ? { Referer: referer } : (origin ? { Referer: `${origin}/` } : {})),
	};
}

/**
 * SSRF-safe fetch with redirect chain tracking and diagnostics.
 */
export async function fetchFeaturedImageUpstream(urlString, {
	timeoutMs = FEATURED_IMAGE_PROXY_TIMEOUT_MS,
	maxRedirects = FEATURED_IMAGE_PROXY_MAX_REDIRECTS,
	method = 'GET',
} = {}) {
	const startedAt = nowMs();
	const diagnostics = {
		originalUrl: String(urlString || ''),
		finalUrl: '',
		method,
		redirectChain: [],
		httpStatus: null,
		responseHeaders: {},
		contentType: null,
		contentLengthHeader: null,
		dns: null,
		durationMs: 0,
		timeoutMs,
		errorStage: null,
	};

	let currentUrl;
	try {
		currentUrl = assertSafePublicHttpUrl(urlString, { fieldName: 'url' });
	} catch (error) {
		diagnostics.errorStage = 'url_validation';
		diagnostics.durationMs = nowMs() - startedAt;
		throw proxyError(
			error.status || 422,
			error.message || 'Invalid image URL',
			error.errorCode || 'INVALID_URL',
			diagnostics,
			error,
		);
	}
	diagnostics.originalUrl = currentUrl;
	diagnostics.finalUrl = currentUrl;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		let redirects = 0;
		while (true) {
			const parsed = new URL(currentUrl);
			try {
				diagnostics.dns = await assertResolvedHostIsPublic(parsed.hostname);
			} catch (error) {
				diagnostics.errorStage = 'dns';
				diagnostics.durationMs = nowMs() - startedAt;
				if (error.diagnostics) {
					error.diagnostics = { ...diagnostics, ...error.diagnostics };
				} else {
					error.diagnostics = diagnostics;
				}
				throw error;
			}

			let response;
			try {
				response = await fetch(currentUrl, {
					method,
					redirect: 'manual',
					signal: controller.signal,
					headers: buildBrowserHeaders(currentUrl, {
						referer: diagnostics.redirectChain[0]?.url || currentUrl,
					}),
				});
			} catch (error) {
				diagnostics.errorStage = 'connection';
				diagnostics.durationMs = nowMs() - startedAt;
				const classified = classifyFetchFailure(error);
				throw proxyError(
					classified.status,
					classified.message,
					classified.errorCode,
					{
						...diagnostics,
						fetchError: error?.message || String(error),
						fetchCode: error?.cause?.code || error?.code || null,
					},
					error,
				);
			}

			diagnostics.httpStatus = response.status;
			diagnostics.responseHeaders = headersToObject(response.headers);
			diagnostics.contentType = parseContentType(response.headers.get('content-type'));
			diagnostics.contentLengthHeader = response.headers.get('content-length');
			diagnostics.finalUrl = currentUrl;

			if (REDIRECT_STATUSES.has(response.status)) {
				const location = response.headers.get('location');
				diagnostics.redirectChain.push({
					url: currentUrl,
					status: response.status,
					location: location || null,
				});
				// Drop redirect bodies so sockets are not held open.
				cancelResponseBody(response);
				if (!location) {
					diagnostics.errorStage = 'redirect';
					diagnostics.durationMs = nowMs() - startedAt;
					throw proxyError(
						502,
						`Image host returned redirect ${response.status} without Location`,
						'PROXY_REDIRECT_INVALID',
						diagnostics,
					);
				}
				if (redirects >= maxRedirects) {
					diagnostics.errorStage = 'redirect';
					diagnostics.durationMs = nowMs() - startedAt;
					throw proxyError(
						422,
						'Too many redirects while fetching image',
						'SSRF_REDIRECT_LIMIT',
						diagnostics,
					);
				}
				let nextUrl;
				try {
					nextUrl = assertSafePublicHttpUrl(new URL(location, currentUrl).toString(), { fieldName: 'url' });
				} catch (error) {
					diagnostics.errorStage = 'redirect';
					diagnostics.durationMs = nowMs() - startedAt;
					throw proxyError(
						error.status || 422,
						error.message || 'Redirect target is not allowed',
						error.errorCode || 'SSRF_BLOCKED',
						diagnostics,
						error,
					);
				}
				currentUrl = nextUrl;
				diagnostics.finalUrl = currentUrl;
				redirects += 1;
				continue;
			}

			diagnostics.durationMs = nowMs() - startedAt;
			return { response, diagnostics, finalUrl: currentUrl };
		}
	} finally {
		clearTimeout(timer);
	}
}

function assertResponseIsImage(diagnostics) {
	const mime = diagnostics.contentType;
	if (isDisallowedDocumentMime(mime)) {
		throw proxyError(
			422,
			`URL returned ${mime || 'a non-image document'} instead of an image (hotlink protection or HTML challenge page)`,
			'PROXY_NOT_IMAGE',
			diagnostics,
		);
	}
	if (mime && !isAllowedImageMime(mime)) {
		throw proxyError(
			422,
			`Unsupported content-type for featured image: ${mime}`,
			'PROXY_UNSUPPORTED_MIME',
			diagnostics,
		);
	}

	const lengthHeader = diagnostics.contentLengthHeader;
	if (lengthHeader != null && lengthHeader !== '') {
		const length = Number(lengthHeader);
		if (Number.isFinite(length) && length > FEATURED_IMAGE_PROXY_MAX_BYTES) {
			throw proxyError(
				413,
				`Featured image is too large (${length} bytes; max ${FEATURED_IMAGE_PROXY_MAX_BYTES})`,
				'PROXY_TOO_LARGE',
				diagnostics,
			);
		}
		if (Number.isFinite(length) && length === 0) {
			throw proxyError(502, 'Featured image was empty', 'PROXY_EMPTY_BODY', diagnostics);
		}
	}
}

/**
 * Diagnose image URL reachability without streaming bytes to the client.
 */
export async function diagnoseFeaturedImageUrl(urlString) {
	const report = {
		ok: false,
		dnsOk: false,
		connectionOk: false,
		redirectOk: true,
		imageDownloaded: false,
		mimeDetected: null,
		contentTypeHeader: null,
		bytesReceived: 0,
		totalLatencyMs: 0,
		httpStatus: null,
		originalUrl: String(urlString || ''),
		finalUrl: '',
		redirectChain: [],
		errorCode: null,
		message: '',
	};

	const startedAt = nowMs();
	let response = null;
	try {
		const upstream = await fetchFeaturedImageUpstream(urlString, {
			method: 'GET',
		});
		response = upstream.response;
		const { diagnostics, finalUrl } = upstream;
		report.dnsOk = Boolean(diagnostics.dns?.dnsOk);
		report.connectionOk = true;
		report.redirectOk = true;
		report.redirectChain = diagnostics.redirectChain;
		report.originalUrl = diagnostics.originalUrl;
		report.finalUrl = finalUrl;
		report.httpStatus = response.status;
		report.contentTypeHeader = diagnostics.contentType;
		report.totalLatencyMs = diagnostics.durationMs;

		if (!response.ok) {
			cancelResponseBody(response);
			report.errorCode = 'PROXY_UPSTREAM_STATUS';
			report.message = `Upstream returned HTTP ${response.status}`;
			report.totalLatencyMs = nowMs() - startedAt;
			return report;
		}

		try {
			assertResponseIsImage(diagnostics);
		} catch (error) {
			cancelResponseBody(response);
			throw error;
		}

		const reader = response.body?.getReader?.();
		if (!reader) {
			const bytes = Buffer.from(await response.arrayBuffer());
			report.bytesReceived = bytes.length;
			report.mimeDetected = detectImageMagic(bytes) || diagnostics.contentType || null;
			report.imageDownloaded = bytes.length > 0;
			if (!report.imageDownloaded) {
				report.errorCode = 'PROXY_EMPTY_BODY';
				report.message = 'Featured image was empty';
			} else if (!detectImageMagic(bytes) && isDisallowedDocumentMime(diagnostics.contentType)) {
				report.errorCode = 'PROXY_NOT_IMAGE';
				report.message = 'Body is not an image';
				report.imageDownloaded = false;
			} else {
				report.ok = true;
				report.message = 'Image downloaded successfully';
			}
			report.totalLatencyMs = nowMs() - startedAt;
			return report;
		}

		let received = 0;
		const peekChunks = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (peekChunks.length < 4) peekChunks.push(Buffer.from(value));
			if (received > FEATURED_IMAGE_PROXY_MAX_BYTES) {
				await reader.cancel().catch(() => null);
				report.bytesReceived = received;
				report.errorCode = 'PROXY_TOO_LARGE';
				report.message = 'Featured image exceeded size limit during download';
				report.totalLatencyMs = nowMs() - startedAt;
				return report;
			}
		}
		const peek = Buffer.concat(peekChunks);
		const magic = detectImageMagic(peek);
		report.bytesReceived = received;
		report.mimeDetected = magic || diagnostics.contentType || null;
		report.imageDownloaded = received > 0;
		if (!received) {
			report.errorCode = 'PROXY_EMPTY_BODY';
			report.message = 'Featured image was empty';
		} else if (!magic && isDisallowedDocumentMime(diagnostics.contentType)) {
			report.errorCode = 'PROXY_NOT_IMAGE';
			report.message = 'Downloaded body is not an image';
			report.imageDownloaded = false;
		} else {
			report.ok = true;
			report.message = 'Image downloaded successfully';
		}
		report.totalLatencyMs = nowMs() - startedAt;
		return report;
	} catch (error) {
		cancelResponseBody(response);
		report.totalLatencyMs = nowMs() - startedAt;
		report.errorCode = error.errorCode || 'PROXY_FETCH_FAILED';
		report.message = error.message || 'Diagnosis failed';
		if (error.diagnostics) {
			report.originalUrl = error.diagnostics.originalUrl || report.originalUrl;
			report.finalUrl = error.diagnostics.finalUrl || report.finalUrl;
			report.redirectChain = error.diagnostics.redirectChain || [];
			report.httpStatus = error.diagnostics.httpStatus;
			report.contentTypeHeader = error.diagnostics.contentType;
			report.dnsOk = Boolean(error.diagnostics.dns?.dnsOk);
			report.connectionOk = error.diagnostics.errorStage !== 'connection' && error.diagnostics.errorStage !== 'dns';
			report.redirectOk = error.diagnostics.errorStage !== 'redirect';
		}
		return report;
	}
}

/**
 * Stream a validated featured image to an Express response.
 */
export async function streamFeaturedImageToResponse(req, res, urlString) {
	const { response, diagnostics, finalUrl } = await fetchFeaturedImageUpstream(urlString, {
		method: 'GET',
	});

	logger.info('Featured image proxy upstream', {
		originalUrl: diagnostics.originalUrl,
		finalUrl,
		httpStatus: response.status,
		contentType: diagnostics.contentType,
		contentLength: diagnostics.contentLengthHeader,
		redirects: diagnostics.redirectChain.length,
		durationMs: diagnostics.durationMs,
		dnsAddresses: diagnostics.dns?.addresses || [],
	});

	if (!response.ok) {
		cancelResponseBody(response);
		throw proxyError(
			502,
			`Featured image fetch failed (HTTP ${response.status})`,
			'PROXY_UPSTREAM_STATUS',
			diagnostics,
		);
	}

	try {
		assertResponseIsImage(diagnostics);
	} catch (error) {
		cancelResponseBody(response);
		throw error;
	}

	const headerMime = diagnostics.contentType || '';
	const reader = response.body?.getReader?.();

	// Fallback when body stream is unavailable.
	if (!reader) {
		try {
			const bytes = Buffer.from(await response.arrayBuffer());
			if (!bytes.length) {
				throw proxyError(502, 'Featured image was empty', 'PROXY_EMPTY_BODY', diagnostics);
			}
			if (bytes.length > FEATURED_IMAGE_PROXY_MAX_BYTES) {
				throw proxyError(413, 'Featured image is too large', 'PROXY_TOO_LARGE', diagnostics);
			}
			const magic = detectImageMagic(bytes);
			if (!magic && isDisallowedDocumentMime(headerMime)) {
				throw proxyError(422, 'URL did not return an image', 'PROXY_NOT_IMAGE', diagnostics);
			}
			if (!magic && headerMime && !isAllowedImageMime(headerMime)) {
				throw proxyError(422, `Unsupported content-type: ${headerMime}`, 'PROXY_UNSUPPORTED_MIME', diagnostics);
			}
			const outType = (headerMime.startsWith('image/') ? headerMime : null) || magic || 'application/octet-stream';
			res.status(200);
			res.setHeader('Content-Type', outType);
			res.setHeader('Cache-Control', 'private, max-age=300');
			res.setHeader('X-Pinblog-Compose', 'featured-proxy');
			res.setHeader('X-Pinblog-Proxy-Final-Url', finalUrl.slice(0, 500));
			res.setHeader('Content-Length', String(bytes.length));
			return res.end(bytes);
		} catch (error) {
			cancelResponseBody(response);
			throw error;
		}
	}

	let received = 0;
	const peekChunks = [];
	let headersSent = false;
	let resolvedType = headerMime.startsWith('image/') ? headerMime : '';
	let clientClosed = false;

	const onClientClose = () => {
		clientClosed = true;
		reader.cancel().catch(() => null);
	};
	req?.once?.('close', onClientClose);

	const ensureHeaders = (magicType) => {
		if (headersSent) return;
		resolvedType = resolvedType || magicType || 'application/octet-stream';
		res.status(200);
		res.setHeader('Content-Type', resolvedType);
		res.setHeader('Cache-Control', 'private, max-age=300');
		res.setHeader('X-Pinblog-Compose', 'featured-proxy');
		res.setHeader('X-Pinblog-Proxy-Final-Url', finalUrl.slice(0, 500));
		if (diagnostics.contentLengthHeader && Number(diagnostics.contentLengthHeader) <= FEATURED_IMAGE_PROXY_MAX_BYTES) {
			res.setHeader('Content-Length', String(diagnostics.contentLengthHeader));
		}
		headersSent = true;
	};

	try {
		while (true) {
			if (clientClosed || res.destroyed || req?.destroyed) {
				await reader.cancel().catch(() => null);
				return undefined;
			}
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = Buffer.from(value);
			received += chunk.length;
			if (received > FEATURED_IMAGE_PROXY_MAX_BYTES) {
				await reader.cancel().catch(() => null);
				throw proxyError(413, 'Featured image is too large', 'PROXY_TOO_LARGE', {
					...diagnostics,
					bytesReceived: received,
				});
			}

			if (!headersSent) {
				peekChunks.push(chunk);
				const peek = Buffer.concat(peekChunks);
				if (peek.length >= 16) {
					const magic = detectImageMagic(peek);
					if (!magic && isDisallowedDocumentMime(headerMime)) {
						throw proxyError(
							422,
							'URL returned a non-image document (hotlink protection or HTML challenge)',
							'PROXY_NOT_IMAGE',
							{ ...diagnostics, bytesReceived: received },
						);
					}
					if (!magic && headerMime && !isAllowedImageMime(headerMime) && headerMime !== 'application/octet-stream') {
						throw proxyError(
							422,
							`Unsupported content-type: ${headerMime}`,
							'PROXY_UNSUPPORTED_MIME',
							diagnostics,
						);
					}
					ensureHeaders(magic);
					for (const part of peekChunks) {
						if (!res.write(part)) {
							await waitForWritableDrain(res);
						}
					}
					peekChunks.length = 0;
				}
				continue;
			}

			if (!res.write(chunk)) {
				await waitForWritableDrain(res);
			}
		}

		if (!headersSent) {
			const peek = Buffer.concat(peekChunks);
			if (!peek.length) {
				throw proxyError(502, 'Featured image was empty', 'PROXY_EMPTY_BODY', diagnostics);
			}
			const magic = detectImageMagic(peek);
			if (!magic && isDisallowedDocumentMime(headerMime)) {
				throw proxyError(422, 'URL did not return an image', 'PROXY_NOT_IMAGE', diagnostics);
			}
			ensureHeaders(magic);
			for (const part of peekChunks) {
				res.write(part);
			}
		}

		diagnostics.bytesReceived = received;
		logger.info('Featured image proxy streamed', {
			finalUrl,
			bytesReceived: received,
			contentType: resolvedType,
			durationMs: diagnostics.durationMs,
		});
		return res.end();
	} catch (error) {
		await reader.cancel().catch(() => null);
		if (headersSent) {
			// Cannot send JSON error after streaming started.
			logger.error('Featured image proxy stream aborted after headers sent', {
				message: error?.message,
				finalUrl,
				bytesReceived: received,
			});
			res.destroy(error);
			return undefined;
		}
		throw error;
	} finally {
		req?.off?.('close', onClientClose);
		req?.removeListener?.('close', onClientClose);
	}
}

/**
 * Send a structured JSON error for proxy failures (never hides the message).
 */
export function sendFeaturedImageProxyError(res, error) {
	const status = Number.isInteger(error?.status) ? error.status : 502;
	const payload = {
		message: error?.message || 'Failed to fetch featured image',
		errorCode: error?.errorCode || 'PROXY_FETCH_FAILED',
		diagnostics: error?.diagnostics
			? {
				originalUrl: error.diagnostics.originalUrl,
				finalUrl: error.diagnostics.finalUrl,
				httpStatus: error.diagnostics.httpStatus,
				contentType: error.diagnostics.contentType,
				contentLength: error.diagnostics.contentLengthHeader,
				redirectChain: error.diagnostics.redirectChain,
				durationMs: error.diagnostics.durationMs,
				errorStage: error.diagnostics.errorStage,
				dnsAddresses: error.diagnostics.dns?.addresses || undefined,
				fetchError: error.diagnostics.fetchError,
				fetchCode: error.diagnostics.fetchCode,
				bytesReceived: error.diagnostics.bytesReceived,
			}
			: undefined,
	};
	logger.warn('Featured image proxy failed', payload);
	return res.status(status).json(payload);
}
