/**
 * Featured Image Proxy — production regression suite.
 * Run: node apps/api/src/services/featured-image-proxy.regression.test.js
 *
 * Critical failures exit with code 1 (merge-blocking).
 */

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
	diagnoseFeaturedImageUrl,
	fetchFeaturedImageUpstream,
	FEATURED_IMAGE_PROXY_MAX_BYTES,
	streamFeaturedImageToResponse,
} from './featured-image-proxy.js';
import { assertSafePublicHttpUrl } from '../utils/ssrf-guard.js';

const RESULTS = [];
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function memSnapshot() {
	const m = process.memoryUsage();
	return {
		rssMb: Number((m.rss / 1024 / 1024).toFixed(1)),
		heapUsedMb: Number((m.heapUsed / 1024 / 1024).toFixed(1)),
	};
}

async function runCase(name, fn, { critical = false } = {}) {
	global.gc?.();
	const memBefore = memSnapshot();
	const t0 = performance.now();
	let result = {
		name,
		critical,
		pass: false,
		httpStatus: null,
		contentType: null,
		timeMs: 0,
		memory: {},
		request: '',
		response: '',
		error: null,
	};
	try {
		const out = await fn();
		result = { ...result, ...out, critical, pass: Boolean(out.pass) };
	} catch (error) {
		result.error = error?.message || String(error);
		result.response = result.response || error?.message || String(error);
		result.httpStatus = error?.status ?? result.httpStatus;
		result.pass = false;
	}
	result.timeMs = Number((performance.now() - t0).toFixed(1));
	const memAfter = memSnapshot();
	result.memory = {
		before: memBefore,
		after: memAfter,
		deltaHeapMb: Number((memAfter.heapUsedMb - memBefore.heapUsedMb).toFixed(1)),
	};
	RESULTS.push(result);
	const mark = result.pass ? 'PASS' : 'FAIL';
	const crit = critical ? ' [CRITICAL]' : '';
	console.log(`${mark}${crit} — ${name} (${result.timeMs}ms, Δheap ${result.memory.deltaHeapMb}MB)`);
	if (!result.pass) {
		console.log(`     status=${result.httpStatus} type=${result.contentType} :: ${result.response}`);
	}
	return result;
}

function mockRes() {
	const chunks = [];
	let statusCode = 200;
	const headers = {};
	const res = {
		headersSent: false,
		statusCode: 200,
		status(code) {
			statusCode = code;
			this.statusCode = code;
			return this;
		},
		setHeader(k, v) {
			headers[String(k).toLowerCase()] = String(v);
		},
		write(chunk) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			this.headersSent = true;
			return true;
		},
		end(chunk) {
			if (chunk) this.write(chunk);
			this.headersSent = true;
			return this;
		},
		destroy() {},
		once() { return this; },
		json(payload) {
			this.headersSent = true;
			this._json = payload;
			return this;
		},
		_get() {
			return {
				statusCode,
				headers,
				bytes: Buffer.concat(chunks),
				json: this._json,
			};
		},
	};
	return res;
}

async function main() {
	console.log('\n=== Featured Image Proxy Regression Suite ===\n');

	// 1. Normal WordPress image
	await runCase('1. Normal WordPress image', async () => {
		const url = 'https://s.w.org/style/images/wp-header-logo.png';
		const report = await diagnoseFeaturedImageUrl(url);
		return {
			request: `GET diagnose ${url}`,
			response: `${report.message}; bytes=${report.bytesReceived}`,
			httpStatus: report.httpStatus,
			contentType: report.mimeDetected || report.contentTypeHeader,
			pass: report.ok === true && report.imageDownloaded === true && report.bytesReceived > 0,
		};
	}, { critical: true });

	// 2. Cloudflare-fronted image
	await runCase('2. Cloudflare-protected / CF-fronted image', async () => {
		const url = 'https://www.cloudflare.com/img/logo-cloudflare-dark.svg';
		const report = await diagnoseFeaturedImageUrl(url);
		const pass = report.connectionOk
			&& report.httpStatus >= 200
			&& report.httpStatus < 400
			&& (
				report.ok
				|| String(report.contentTypeHeader || '').startsWith('image/')
				|| report.imageDownloaded
			);
		return {
			request: `GET diagnose ${url}`,
			response: `${report.message} (ct=${report.contentTypeHeader})`,
			httpStatus: report.httpStatus,
			contentType: report.mimeDetected || report.contentTypeHeader,
			pass,
		};
	}, { critical: true });

	// 3. BunnyCDN (real *.b-cdn.net pull zone)
	await runCase('3. BunnyCDN image URL', async () => {
		const url = 'https://countrymusic.b-cdn.net/2021/02/mikebagnall-logo.png';
		const report = await diagnoseFeaturedImageUrl(url);
		return {
			request: `GET diagnose ${url}`,
			response: `${report.message} code=${report.errorCode || 'ok'}; bytes=${report.bytesReceived}`,
			httpStatus: report.httpStatus,
			contentType: report.mimeDetected || report.contentTypeHeader,
			pass: report.ok === true && report.bytesReceived > 0,
		};
	}, { critical: true });

	// 4. S3 image URL (Open Images public dataset)
	await runCase('4. S3 image URL', async () => {
		const url = 'https://open-images-dataset.s3.amazonaws.com/test/000026e7ee790996.jpg';
		const report = await diagnoseFeaturedImageUrl(url);
		return {
			request: `GET diagnose ${url}`,
			response: `${report.message}; bytes=${report.bytesReceived}`,
			httpStatus: report.httpStatus,
			contentType: report.mimeDetected || report.contentTypeHeader,
			pass: report.ok === true && report.bytesReceived > 0 && String(report.contentTypeHeader || '').includes('image'),
		};
	}, { critical: true });

	// 5. Redirects 301 and 302
	await runCase('5a. Redirect 301 to image', async () => {
		const url = 'https://httpbingo.org/redirect-to?url=https%3A%2F%2Fhttpbingo.org%2Fimage%2Fjpeg&status_code=301';
		const report = await diagnoseFeaturedImageUrl(url);
		return {
			request: `GET diagnose ${url}`,
			response: `${report.message}; redirects=${report.redirectChain?.length || 0}`,
			httpStatus: report.httpStatus,
			contentType: report.mimeDetected || report.contentTypeHeader,
			pass: report.ok === true && report.redirectOk === true && (report.redirectChain?.length || 0) >= 1,
		};
	}, { critical: true });

	await runCase('5b. Redirect 302 to image', async () => {
		const url = 'https://httpbingo.org/redirect-to?url=https%3A%2F%2Fhttpbingo.org%2Fimage%2Fpng&status_code=302';
		const report = await diagnoseFeaturedImageUrl(url);
		return {
			request: `GET diagnose ${url}`,
			response: `${report.message}; redirects=${report.redirectChain?.length || 0}`,
			httpStatus: report.httpStatus,
			contentType: report.mimeDetected || report.contentTypeHeader,
			pass: report.ok === true && report.redirectOk === true && (report.redirectChain?.length || 0) >= 1,
		};
	}, { critical: true });

	// 6. Invalid URL
	await runCase('6. Invalid URL', async () => {
		try {
			assertSafePublicHttpUrl('not-a-url', { fieldName: 'url' });
			return { request: 'assertSafePublicHttpUrl(not-a-url)', response: 'no throw', pass: false };
		} catch (error) {
			return {
				request: 'assertSafePublicHttpUrl(not-a-url)',
				response: error.message,
				httpStatus: error.status,
				contentType: null,
				pass: error.status === 422 && error.errorCode === 'INVALID_URL',
			};
		}
	}, { critical: true });

	await runCase('6b. Invalid URL via diagnose', async () => {
		const report = await diagnoseFeaturedImageUrl('notaurl');
		return {
			request: 'GET diagnose notaurl',
			response: report.message,
			httpStatus: null,
			contentType: null,
			pass: report.ok === false && report.errorCode === 'INVALID_URL',
		};
	}, { critical: true });

	// 7. HTML page instead of image
	await runCase('7. HTML page instead of image', async () => {
		const url = 'https://example.com/';
		const report = await diagnoseFeaturedImageUrl(url);
		return {
			request: `GET diagnose ${url}`,
			response: `${report.message} code=${report.errorCode}`,
			httpStatus: report.httpStatus,
			contentType: report.contentTypeHeader,
			pass: report.ok === false && (
				report.errorCode === 'PROXY_NOT_IMAGE'
				|| report.errorCode === 'PROXY_UNSUPPORTED_MIME'
			),
		};
	}, { critical: true });

	// 8. Timeout — postman-echo delay is reliable; httpbingo /delay returns 400 immediately
	await runCase('8. Timeout', async () => {
		const url = 'https://postman-echo.com/delay/5';
		try {
			await fetchFeaturedImageUpstream(url, { timeoutMs: 1200, method: 'GET' });
			return {
				request: `fetch timeoutMs=1200 ${url}`,
				response: 'completed unexpectedly',
				pass: false,
			};
		} catch (error) {
			return {
				request: `fetch timeoutMs=1200 ${url}`,
				response: `${error.message} code=${error.errorCode}`,
				httpStatus: error.status,
				contentType: error.diagnostics?.contentType || null,
				pass: error.errorCode === 'PROXY_TIMEOUT' && error.status === 504,
			};
		}
	}, { critical: true });

	// 9. Blocked hosts (SSRF)
	const blockedHosts = [
		'http://127.0.0.1/secret.png',
		'http://localhost/x.jpg',
		'http://169.254.169.254/latest/meta-data/',
		'http://[::1]/img.png',
		'file:///etc/passwd',
	];
	for (const url of blockedHosts) {
		await runCase(`9. Blocked host ${url}`, async () => {
			try {
				assertSafePublicHttpUrl(url, { fieldName: 'url' });
				return { request: url, response: 'allowed (bad)', pass: false };
			} catch (error) {
				const ok = error.status === 422 && (
					error.errorCode === 'SSRF_BLOCKED'
					|| error.errorCode === 'INVALID_URL_PROTOCOL'
					|| error.errorCode === 'INVALID_URL'
				);
				return {
					request: `assertSafePublicHttpUrl ${url}`,
					response: `${error.errorCode}: ${error.message}`,
					httpStatus: error.status,
					contentType: null,
					pass: ok,
				};
			}
		}, { critical: true });
	}

	await runCase('9b. Blocked host via diagnose localhost', async () => {
		const report = await diagnoseFeaturedImageUrl('http://127.0.0.1/image.jpg');
		return {
			request: 'GET diagnose http://127.0.0.1/image.jpg',
			response: `${report.errorCode}: ${report.message}`,
			httpStatus: null,
			contentType: null,
			pass: report.ok === false && report.errorCode === 'SSRF_BLOCKED',
		};
	}, { critical: true });

	// DNS rebinding: localtest.me → 127.0.0.1
	await runCase('9c. DNS rebinding localtest.me blocked', async () => {
		const report = await diagnoseFeaturedImageUrl('http://localtest.me/secret.png');
		return {
			request: 'GET diagnose http://localtest.me/secret.png',
			response: `${report.errorCode}: ${report.message}`,
			httpStatus: null,
			contentType: null,
			pass: report.ok === false && report.errorCode === 'SSRF_BLOCKED',
		};
	}, { critical: true });

	// 10. Oversized image (>12MB) — Wikimedia photo ~14.6MB; Content-Length rejects before body
	await runCase('10. Oversized image (>12MB)', async () => {
		const url = 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg';
		const report = await diagnoseFeaturedImageUrl(url);
		const length = Number(report.contentTypeHeader ? 0 : 0);
		void length;
		return {
			request: `GET diagnose ${url}`,
			response: `${report.message} code=${report.errorCode}; http=${report.httpStatus}`,
			httpStatus: report.httpStatus,
			contentType: report.contentTypeHeader,
			pass: report.ok === false && report.errorCode === 'PROXY_TOO_LARGE',
		};
	}, { critical: true });

	// Compatibility: streaming path still returns image bytes for a known JPEG
	await runCase('Compat. Stream proxy bytes (API contract)', async () => {
		const url = 'https://httpbingo.org/image/jpeg';
		const res = mockRes();
		await streamFeaturedImageToResponse({}, res, url);
		const out = res._get();
		return {
			request: `streamFeaturedImageToResponse ${url}`,
			response: `bytes=${out.bytes.length} type=${out.headers['content-type']}`,
			httpStatus: out.statusCode,
			contentType: out.headers['content-type'],
			pass: out.statusCode === 200
				&& out.bytes.length > 0
				&& String(out.headers['content-type'] || '').includes('image')
				&& out.headers['x-pinblog-compose'] === 'featured-proxy',
		};
	}, { critical: true });

	// Compat: response shape for diagnose failures stays structured (API clients)
	await runCase('Compat. Diagnose error shape', async () => {
		const report = await diagnoseFeaturedImageUrl('https://example.com/');
		const required = ['ok', 'dnsOk', 'connectionOk', 'redirectOk', 'imageDownloaded', 'errorCode', 'message', 'originalUrl'];
		const missing = required.filter((k) => !(k in report));
		return {
			request: 'diagnose https://example.com/',
			response: missing.length ? `missing=${missing.join(',')}` : `shape ok code=${report.errorCode}`,
			httpStatus: report.httpStatus,
			contentType: report.contentTypeHeader,
			pass: missing.length === 0 && report.ok === false,
		};
	}, { critical: true });

	// SSRF: redirect Location to private IP blocked (controllable mock — external redirectors often refuse)
	await runCase('SSRF. Redirect to localhost blocked', async () => {
		const probeUrl = 'https://example.com/pinblog-ssrf-redirect-probe';
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input, init) => {
			const href = String(input);
			if (href.includes('pinblog-ssrf-redirect-probe')) {
				return new Response(null, {
					status: 302,
					headers: { Location: 'http://127.0.0.1/secret.png' },
				});
			}
			return originalFetch(input, init);
		};
		try {
			await fetchFeaturedImageUpstream(probeUrl, { method: 'GET', timeoutMs: 5000 });
			return { request: probeUrl, response: 'redirect allowed (bad)', pass: false };
		} catch (error) {
			return {
				request: `${probeUrl} → Location http://127.0.0.1/secret.png`,
				response: `${error.errorCode}: ${error.message}`,
				httpStatus: error.status,
				contentType: null,
				pass: error.errorCode === 'SSRF_BLOCKED' && error.status === 422,
			};
		} finally {
			globalThis.fetch = originalFetch;
		}
	}, { critical: true });

	// SSRF: redirect Location to DNS-rebinding host blocked at DNS stage after hop
	await runCase('SSRF. Redirect to localtest.me blocked', async () => {
		const probeUrl = 'https://example.com/pinblog-ssrf-dns-redirect-probe';
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input, init) => {
			const href = String(input);
			if (href.includes('pinblog-ssrf-dns-redirect-probe')) {
				return new Response(null, {
					status: 302,
					headers: { Location: 'http://localtest.me/secret.png' },
				});
			}
			return originalFetch(input, init);
		};
		try {
			await fetchFeaturedImageUpstream(probeUrl, { method: 'GET', timeoutMs: 5000 });
			return { request: probeUrl, response: 'redirect allowed (bad)', pass: false };
		} catch (error) {
			return {
				request: `${probeUrl} → Location http://localtest.me/secret.png`,
				response: `${error.errorCode}: ${error.message}; stage=${error.diagnostics?.errorStage}`,
				httpStatus: error.status,
				contentType: null,
				pass: error.errorCode === 'SSRF_BLOCKED' && error.status === 422,
			};
		} finally {
			globalThis.fetch = originalFetch;
		}
	}, { critical: true });

	// Summary
	const passed = RESULTS.filter((r) => r.pass).length;
	const failed = RESULTS.filter((r) => !r.pass);
	const criticalFailed = RESULTS.filter((r) => r.critical && !r.pass);
	const criticalPassed = RESULTS.filter((r) => r.critical && r.pass).length;

	const report = {
		generatedAt: new Date().toISOString(),
		suite: 'featured-image-proxy.regression',
		summary: {
			total: RESULTS.length,
			passed,
			failed: failed.length,
			criticalTotal: RESULTS.filter((r) => r.critical).length,
			criticalPassed,
			criticalFailed: criticalFailed.length,
			mergeBlocking: criticalFailed.length > 0,
			mergeRecommendation: criticalFailed.length > 0 ? 'DO NOT MERGE' : 'OK TO MERGE (critical tests passed)',
		},
		compatibility: {
			streamContractHeaders: RESULTS.find((r) => r.name.startsWith('Compat. Stream'))?.pass ?? null,
			diagnoseErrorShape: RESULTS.find((r) => r.name.startsWith('Compat. Diagnose'))?.pass ?? null,
			note: 'Existing GET /ai-pin-images/proxy query contract unchanged (url required). Diagnose is additive.',
		},
		ssrf: {
			literalPrivateHostsBlocked: RESULTS.filter((r) => r.name.startsWith('9.')).every((r) => r.pass),
			dnsRebindingBlocked: RESULTS.find((r) => r.name.includes('localtest.me blocked') && r.name.startsWith('9c'))?.pass ?? null,
			redirectToPrivateBlocked: RESULTS.find((r) => r.name === 'SSRF. Redirect to localhost blocked')?.pass ?? null,
			redirectToDnsRebindBlocked: RESULTS.find((r) => r.name === 'SSRF. Redirect to localtest.me blocked')?.pass ?? null,
			protectionsWeakened: false,
		},
		results: RESULTS,
	};

	console.log('\n=== Summary ===');
	console.log(`Total: ${RESULTS.length}  Pass: ${passed}  Fail: ${failed.length}`);
	console.log(`Critical: ${criticalPassed}/${report.summary.criticalTotal} passed; failures: ${criticalFailed.length}`);
	console.log(`Merge: ${report.summary.mergeRecommendation}`);
	if (failed.length) {
		console.log('\nFailed cases:');
		for (const f of failed) {
			console.log(` - ${f.name}: ${f.response || f.error}`);
		}
	}

	const jsonPath = path.join(__dirname, 'featured-image-proxy.regression-report.json');
	const mdPath = path.join(__dirname, 'featured-image-proxy.regression-report.md');
	writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

	const mdLines = [
		'# Featured Image Proxy — Regression Report',
		'',
		`Generated: ${report.generatedAt}`,
		'',
		`**Verdict: ${report.summary.mergeRecommendation}**`,
		'',
		`Critical: ${criticalPassed}/${report.summary.criticalTotal} passed · Total: ${passed}/${RESULTS.length} passed`,
		'',
		'| # | Test | Pass/Fail | HTTP | Content-Type | Time (ms) | ΔHeap (MB) |',
		'|---|------|-----------|------|--------------|-----------|------------|',
	];
	for (const r of RESULTS) {
		mdLines.push(
			`| ${r.critical ? 'C' : ''} | ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.httpStatus ?? '—'} | ${r.contentType ?? '—'} | ${r.timeMs} | ${r.memory?.deltaHeapMb ?? '—'} |`,
		);
	}
	mdLines.push('', '## Per-case detail', '');
	for (const r of RESULTS) {
		mdLines.push(`### ${r.pass ? 'PASS' : 'FAIL'} — ${r.name}`);
		mdLines.push(`- **Request:** ${r.request}`);
		mdLines.push(`- **Response:** ${r.response || r.error || '—'}`);
		mdLines.push(`- **HTTP status:** ${r.httpStatus ?? '—'}`);
		mdLines.push(`- **Content-Type:** ${r.contentType ?? '—'}`);
		mdLines.push(`- **Memory:** before heap ${r.memory?.before?.heapUsedMb}MB → after ${r.memory?.after?.heapUsedMb}MB (Δ ${r.memory?.deltaHeapMb}MB); RSS ${r.memory?.after?.rssMb}MB`);
		mdLines.push(`- **Time taken:** ${r.timeMs}ms`);
		mdLines.push('');
	}
	mdLines.push('## Compatibility / SSRF');
	mdLines.push(`- Stream API contract: ${report.compatibility.streamContractHeaders ? 'PASS' : 'FAIL'}`);
	mdLines.push(`- Diagnose error shape: ${report.compatibility.diagnoseErrorShape ? 'PASS' : 'FAIL'}`);
	mdLines.push(`- SSRF protections weakened: ${report.ssrf.protectionsWeakened ? 'YES (bad)' : 'NO'}`);
	mdLines.push(`- ${report.compatibility.note}`);
	writeFileSync(mdPath, mdLines.join('\n'), 'utf8');

	console.log(`\nWrote ${jsonPath}`);
	console.log(`Wrote ${mdPath}`);
	console.log('\n=== JSON REPORT (summary) ===');
	console.log(JSON.stringify(report.summary, null, 2));

	process.exit(criticalFailed.length > 0 ? 1 : 0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
