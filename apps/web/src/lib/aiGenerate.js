import { integratedAiClient } from '@/lib/integratedAiClient';

// Streams a text response from the AI backend and returns the full accumulated text.
export async function generateText(prompt, { onChunk, signal } = {}) {
	const response = await integratedAiClient.stream('/integrated-ai/stream', {
		body: { message: [{ text: prompt, type: 'text' }] },
		images: [],
		signal,
	});

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let full = '';
	const images = [];

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const events = buffer.split('\n\n');
		buffer = events.pop() || '';
		for (const event of events) {
			if (!event.trim()) continue;
			let data = '';
			for (const line of event.split('\n')) {
				if (line.startsWith('data: ')) data += line.slice(6);
			}
			if (!data) continue;
			const parsed = JSON.parse(data);
			if (parsed.type === 'error') throw new Error(parsed.data.content);
			if (parsed.type === 'completed') return { text: full, images };
			if (parsed.type === 'content') {
				full += parsed.data.content;
				onChunk?.(full);
			}
			if (parsed.type === 'tool_result' && parsed.data.tool_name === 'generate_image' && parsed.data.content) {
				images.push(parsed.data.content);
			}
		}
	}
	return { text: full, images };
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
