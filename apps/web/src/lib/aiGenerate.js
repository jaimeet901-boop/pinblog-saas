import { integratedAiClient } from '@/lib/integratedAiClient';

function inferStreamPhase(fullText, previousPhase) {
	const text = String(fullText || '');
	if (!text.trim()) return previousPhase === 'connecting' ? 'connecting' : previousPhase;
	// Real stream content: move past connecting based on what arrived.
	if (
		/"sections"\s*:/.test(text)
		|| /"introduction"\s*:/.test(text)
		|| /"faq"\s*:/.test(text)
		|| text.length > 450
	) {
		return 'writing';
	}
	return 'outline';
}

function cancelledError(partialText = '') {
	const err = new Error('Generation cancelled');
	err.name = 'AbortError';
	err.errorCode = 'GENERATION_CANCELLED';
	err.partialText = partialText;
	return err;
}

/**
 * Streams a text response from the AI backend and returns the full accumulated text.
 * Pass singleShot: true for one-off generation (Writer) — skips shared chat history.
 *
 * onStatus phases (client-only; does not change API contract):
 * connecting | outline | writing | finalizing
 *
 * Pass AbortSignal to cancel. No automatic reconnect.
 * There is no dedicated cancel API — aborting fetch closes the SSE (server settles via existing flow).
 */
export async function generateText(prompt, {
	onChunk,
	onStatus,
	signal,
	customPrompt,
	singleShot,
	idempotencyKey,
	creditFeature,
} = {}) {
	if (signal?.aborted) {
		throw cancelledError('');
	}

	onStatus?.('connecting');

	let ignoreIncoming = false;
	let reader = null;
	let full = '';

	const markCancelled = () => {
		ignoreIncoming = true;
		try {
			reader?.cancel?.();
		} catch {
			/* ignore */
		}
	};

	if (signal) {
		signal.addEventListener('abort', markCancelled, { once: true });
	}

	try {
		const response = await integratedAiClient.stream('/integrated-ai/stream', {
			body: {
				message: [{ text: prompt, type: 'text' }],
				...(customPrompt ? { customPrompt: String(customPrompt) } : {}),
				...(singleShot ? { singleShot: true } : {}),
				...(idempotencyKey ? { idempotencyKey: String(idempotencyKey) } : {}),
				...(creditFeature ? { creditFeature: String(creditFeature) } : {}),
			},
			images: [],
			signal,
		});

		if (ignoreIncoming || signal?.aborted) {
			throw cancelledError(full);
		}

		reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		const images = [];
		let phase = 'connecting';

		while (true) {
			if (ignoreIncoming || signal?.aborted) {
				throw cancelledError(full);
			}

			const { done, value } = await reader.read();
			if (done) break;
			if (ignoreIncoming || signal?.aborted) {
				throw cancelledError(full);
			}

			buffer += decoder.decode(value, { stream: true });
			const events = buffer.split('\n\n');
			buffer = events.pop() || '';
			for (const event of events) {
				if (ignoreIncoming || signal?.aborted) {
					throw cancelledError(full);
				}
				if (!event.trim()) continue;
				let data = '';
				for (const line of event.split('\n')) {
					if (line.startsWith('data: ')) data += line.slice(6);
				}
				if (!data) continue;
				const parsed = JSON.parse(data);
				if (parsed.type === 'error') {
					const err = new Error(parsed.data?.content || 'Generation failed');
					err.errorCode = 'STREAM_ERROR';
					throw err;
				}
				if (parsed.type === 'completed') {
					if (ignoreIncoming || signal?.aborted) {
						throw cancelledError(full);
					}
					onStatus?.('finalizing');
					return { text: full, images };
				}
				if (parsed.type === 'content') {
					if (ignoreIncoming || signal?.aborted) {
						continue;
					}
					full += parsed.data.content;
					const nextPhase = inferStreamPhase(full, phase);
					if (nextPhase !== phase) {
						phase = nextPhase;
						onStatus?.(phase);
					} else if (phase === 'connecting') {
						phase = 'outline';
						onStatus?.('outline');
					}
					onChunk?.(full);
				}
				if (parsed.type === 'tool_result' && parsed.data.tool_name === 'generate_image' && parsed.data.content) {
					if (!ignoreIncoming && !signal?.aborted) {
						images.push(parsed.data.content);
					}
				}
			}
		}

		if (ignoreIncoming || signal?.aborted) {
			throw cancelledError(full);
		}

		onStatus?.('finalizing');
		return { text: full, images };
	} catch (error) {
		if (ignoreIncoming || signal?.aborted || error?.name === 'AbortError'
			|| String(error?.errorCode || '').toUpperCase() === 'GENERATION_CANCELLED') {
			throw cancelledError(full || error?.partialText || '');
		}
		throw error;
	} finally {
		if (signal) {
			signal.removeEventListener('abort', markCancelled);
		}
	}
}

// Attempts to extract a JSON object from an AI text response.
export function extractJson(text) {
	if (!text) return null;
	let t = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
	const start = t.indexOf('{');
	const end = t.lastIndexOf('}');
	if (start === -1 || end === -1) return null;
	try {
		return JSON.parse(t.slice(start, end + 1));
	} catch {
		return null;
	}
}
