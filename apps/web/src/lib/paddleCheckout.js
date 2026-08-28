/**
 * Paddle.js overlay for the Default Payment Link page (/app/subscription).
 * Opens an existing transaction from ?_ptxn=. Never creates a transaction.
 */

import { initializePaddle } from '@paddle/paddle-js';

const MISSING_TOKEN_MESSAGE = '[paddleCheckout] VITE_PADDLE_CLIENT_TOKEN is missing. Cannot initialize Paddle.js.';

let initializePromise = null;
let openedTransactionId = null;

function readEnvToken(env) {
	const source = env ?? (typeof import.meta !== 'undefined' ? import.meta.env : undefined);
	return String(source?.VITE_PADDLE_CLIENT_TOKEN || '').trim();
}

/** Paddle.js environment: sandbox (default) or production. Accepts live → production. */
export function readPaddleJsEnvironment(env) {
	const source = env ?? (typeof import.meta !== 'undefined' ? import.meta.env : undefined);
	const raw = String(source?.VITE_PADDLE_ENVIRONMENT || '').trim().toLowerCase();
	if (raw === 'production' || raw === 'live') return 'production';
	return 'sandbox';
}

export function readPaddleTransactionId(search = '') {
	const raw = String(search || '').trim();
	if (!raw) return '';
	try {
		const query = raw.includes('://')
			? new URL(raw).search
			: raw.startsWith('?')
				? raw
				: `?${raw}`;
		return String(new URLSearchParams(query).get('_ptxn') || '').trim();
	} catch {
		return '';
	}
}

export function resetPaddleCheckoutGuards() {
	initializePromise = null;
	openedTransactionId = null;
}

/**
 * If the current URL has _ptxn, initialize Paddle.js once and open that transaction.
 * @param {object} [options]
 * @param {string} [options.search]
 * @param {object} [options.env]
 * @param {typeof initializePaddle} [options.initializePaddle]
 */
export async function maybeOpenPaddleCheckoutFromUrl(options = {}) {
	const search = options.search
		?? (typeof window !== 'undefined' ? window.location.search : '');
	const transactionId = readPaddleTransactionId(search);
	if (!transactionId) {
		return { opened: false, reason: 'no_ptxn' };
	}

	if (openedTransactionId === transactionId) {
		return { opened: false, reason: 'already_opened', transactionId };
	}

	const token = readEnvToken(options.env);
	if (!token) {
		console.error(MISSING_TOKEN_MESSAGE);
		return { opened: false, reason: 'missing_token', transactionId };
	}

	const init = typeof options.initializePaddle === 'function'
		? options.initializePaddle
		: initializePaddle;

	openedTransactionId = transactionId;

	try {
		if (!initializePromise) {
			initializePromise = init({
				environment: readPaddleJsEnvironment(options.env),
				token,
			});
		}
		const paddle = await initializePromise;
		if (!paddle?.Checkout?.open) {
			throw new Error('Paddle.js Checkout.open is unavailable');
		}
		paddle.Checkout.open({ transactionId });
		return { opened: true, transactionId };
	} catch (error) {
		openedTransactionId = null;
		initializePromise = null;
		console.error('[paddleCheckout] Failed to open Paddle checkout.', error);
		return { opened: false, reason: 'open_failed', transactionId };
	}
}
