import { integratedAiClient } from '@/lib/integratedAiClient';
import {
	buildContinuationPrompt,
	countArticleWords,
	mergeArticleContinuation,
	resolveWriterLengthPreset,
} from '@/lib/writerArticleLength.js';

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

async function streamOnce({
	prompt,
	onChunk,
	onStatus,
	signal,
	customPrompt,
	singleShot,
	idempotencyKey,
	creditFeature,
	articleLength,
	minWords,
	maxWords,
	writerContinuation,
}) {
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
				...(articleLength ? { articleLength: String(articleLength) } : {}),
				...(minWords != null ? { minWords: String(minWords) } : {}),
				...(maxWords != null ? { maxWords: String(maxWords) } : {}),
				...(writerContinuation ? { writerContinuation: true } : {}),
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

/**
 * Streams a text response from the AI backend and returns the full accumulated text.
 * Pass singleShot: true for one-off generation (Writer) — skips shared chat history.
 *
 * When articleLength/minWords/maxWords are provided, enforces length via backend prompts
 * and performs at most one continuation merge if the first draft is under minWords.
 */
export async function generateText(prompt, {
	onChunk,
	onStatus,
	signal,
	customPrompt,
	singleShot,
	idempotencyKey,
	creditFeature,
	articleLength,
	minWords,
	maxWords,
	language,
	skipLengthContinuation = false,
} = {}) {
	const preset = articleLength || minWords || maxWords
		? resolveWriterLengthPreset(articleLength || '')
		: null;
	const resolvedMin = Number(minWords) > 0 ? Number(minWords) : (preset?.minWords || null);
	const resolvedMax = Number(maxWords) > 0 ? Number(maxWords) : (preset?.maxWords || null);
	const resolvedLengthId = preset?.id || (articleLength ? String(articleLength) : null);

	const first = await streamOnce({
		prompt,
		onChunk,
		onStatus,
		signal,
		customPrompt,
		singleShot,
		idempotencyKey,
		creditFeature,
		articleLength: resolvedLengthId,
		minWords: resolvedMin,
		maxWords: resolvedMax,
		writerContinuation: false,
	});

	if (skipLengthContinuation || !resolvedMin || !singleShot) {
		return first;
	}

	const article = extractJson(first.text);
	if (!article) {
		return first;
	}

	const currentWords = countArticleWords(article);
	if (currentWords >= resolvedMin) {
		return {
			...first,
			article,
			wordCount: currentWords,
			continued: false,
		};
	}

	if (signal?.aborted) {
		throw cancelledError(first.text);
	}

	onStatus?.('writing');
	const continuationPrompt = buildContinuationPrompt(article, {
		minWords: resolvedMin,
		maxWords: resolvedMax || preset?.maxWords || resolvedMin,
		currentWords,
		language,
	});

	const continuation = await streamOnce({
		prompt: continuationPrompt,
		onChunk: (text) => {
			// Show continuation stream separately; final merge happens after parse.
			onChunk?.(text);
		},
		onStatus,
		signal,
		customPrompt: '',
		singleShot: true,
		idempotencyKey: idempotencyKey
			? `${String(idempotencyKey).slice(0, 100)}:cont`
			: undefined,
		creditFeature: undefined,
		articleLength: resolvedLengthId,
		minWords: resolvedMin,
		maxWords: resolvedMax,
		writerContinuation: true,
	});

	const patch = extractJson(continuation.text);
	const merged = mergeArticleContinuation(article, patch);
	const mergedText = JSON.stringify(merged);
	const mergedWords = countArticleWords(merged);
	onChunk?.(mergedText);
	onStatus?.('finalizing');

	return {
		text: mergedText,
		images: [...(first.images || []), ...(continuation.images || [])],
		article: merged,
		wordCount: mergedWords,
		continued: true,
		initialWordCount: currentWords,
	};
}
