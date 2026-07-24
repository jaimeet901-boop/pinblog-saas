import process from 'node:process';
import { PassThrough, Readable } from 'node:stream';
import { NodeEnv } from '../constants/common.js';
import logger from '../utils/logger.js';
import { getEnv } from '../utils/env.js';
import pocketbaseClient from '../utils/pocketbaseClient.js';

const MessageRole = Object.freeze({
	User: 'user',
	Assistant: 'assistant',
	Tool: 'tool',
});

const SSEEventType = Object.freeze({
	Content: 'content',
	Reasoning: 'reasoning',
	ToolUse: 'tool_use',
	ToolResult: 'tool_result',
	Usage: 'usage',
	Error: 'error',
	Done: 'done',
	Completed: 'completed',
});

export const ContentBlockType = Object.freeze({
	Text: 'text',
	Image: 'image',
});

const MAX_HISTORY_MESSAGES = 60;

/**
 * Build a clear Error from a PocketBase ClientResponseError without hiding details.
 * Logs status, response body, and request URL.
 *
 * @param {unknown} error
 * @param {string} context
 * @returns {Error}
 */
function pocketBaseRequestError(error, context) {
	const status = Number(error?.status) || Number(error?.response?.status) || 0;
	const url = String(error?.url || error?.response?.url || '').trim();
	const responseData = error?.response?.data ?? error?.data ?? null;
	const responseMessage = typeof responseData?.message === 'string' ? responseData.message : '';
	const fieldErrors = responseData?.data && typeof responseData.data === 'object'
		? responseData.data
		: null;

	const fieldDetail = fieldErrors
		? Object.entries(fieldErrors)
			.map(([field, value]) => {
				if (!value) return '';
				if (typeof value === 'string') return `${field}: ${value}`;
				if (typeof value?.message === 'string') return `${field}: ${value.message}`;
				try {
					return `${field}: ${JSON.stringify(value)}`;
				} catch {
					return `${field}: [unserializable]`;
				}
			})
			.filter(Boolean)
			.join('; ')
		: '';

	logger.error('[integrated-ai] PocketBase request failed', {
		context,
		status: status || null,
		url: url || null,
		responseData,
		originalMessage: error?.message || null,
	});

	const parts = [
		context,
		status ? `HTTP ${status}` : null,
		responseMessage || error?.message || 'PocketBase request failed',
		fieldDetail ? `(${fieldDetail})` : null,
		url ? `url=${url}` : null,
	].filter(Boolean);

	const next = new Error(parts.join(' — '));
	next.status = status || 500;
	next.errorCode = 'POCKETBASE_ERROR';
	next.pocketbase = {
		status: status || null,
		url: url || null,
		data: responseData,
	};
	next.cause = error;
	return next;
}

const HistoryEventTypes = new Set([
	SSEEventType.Reasoning,
	SSEEventType.Content,
	SSEEventType.ToolUse,
	SSEEventType.ToolResult,
	SSEEventType.Error,
]);

const SquashableSSEEventTypes = new Set([
	SSEEventType.Content,
	SSEEventType.Reasoning,
	SSEEventType.Error,
]);

/**
 * @typedef {typeof SSEEventType[keyof typeof SSEEventType]} SSEEventTypeValue
 */

/**
 * @typedef {object} SSEEventContent
 * @property {'content'} type
 * @property {{ content: string }} data
 * @property {{ agentName?: string }} [metadata]
 */

/**
 * @typedef {object} SSEEventToolUse
 * @property {'tool_use'} type
 * @property {{ toolId: string, toolName: string, inputParams: Record<string, any> }} data
 * @property {{ agentName?: string }} [metadata]
 */

/**
 * @typedef {object} SSEEventToolResult
 * @property {'tool_result'} type
 * @property {{ toolCallId: string, content: string }} data
 * @property {{ agentName?: string }} [metadata]
 */

/**
 * @typedef {object} GenerateImageInput
 * @property {string} prompt
 * @property {string} image_size
 */

/**
 * @typedef {object} GenerateImageToolCall
 * @property {string} id
 * @property {'generate_image'} name
 * @property {GenerateImageInput} input
 * @property {string} [thought_signature]
 */

/**
 * @typedef {object} SSEEventToolUseGenerateImage
 * @property {'tool_use'} type
 * @property {{ role: string, agent_name: string, content: string, tool_calls: GenerateImageToolCall[] }} data
 * @property {{ agent_name: string }} [metadata]
 */

/**
 * @typedef {object} SSEEventToolResultGenerateImage
 * @property {'tool_result'} type
 * @property {{ tool_call_id: string, tool_name: 'generate_image', agent_name: string, content: string }} data
 * @property {{ agent_name: string }} [metadata]
 */

/**
 * @typedef {object} SSEEventUsage
 * @property {'usage'} type
 * @property {{ input_tokens: number, output_total_tokens: number, output_reasoning_tokens: number, output_non_reasoning_tokens: number, cache_creation_tokens: number, cache_read_tokens: number }} data
 */

/**
 * @typedef {object} SSEEventError
 * @property {'error'} type
 * @property {{ content: string }} data
 */

/**
 * @typedef {object} SSEEventDone
 * @property {'done'} type
 * @property {{ content: string }} data
 */

/**
 * @typedef {SSEEventContent | SSEEventToolUse | SSEEventToolResult | SSEEventUsage | SSEEventError | SSEEventDone} SSEEvent
 */

/**
 * @typedef {SSEEventContent | SSEEventToolUse | SSEEventToolResult} SSEEventHistory
 */

/**
 * @typedef {object} TextContentBlock
 * @property {string} text
 * @property {'text'} type
 */

/**
 * @typedef {object} ImageContentBlock
 * @property {string} image
 * @property {'image'} type
 */

/**
 * @typedef {TextContentBlock | ImageContentBlock} ContentBlock
 */

/**
 * @typedef {object} HistoryMessage
 * @property {string} role
 * @property {string} content
 * @property {string[]} [images]
 * @property {Array<{ id: string, type: string, function: { name: string, arguments: string } }>} [tool_calls]
 * @property {string} [tool_call_id]
 * @property {string} [agent_name]
 */

/**
 * Uploads images to PocketBase and returns their URLs.
 *
 * @param {{ files: Express.Multer.File[] }} params
 * @returns {Promise<string[]>}
 */
export async function uploadImagesToPocketBase({ images }) {
	const uploadPromises = images.map(async (file) => {
		const formData = new FormData();
		const blob = new Blob([file.buffer], { type: file.mimetype });
		formData.append('file', blob, file.originalname);

		let record;
		try {
			record = await pocketbaseClient.collection('_integratedAiImages').create(formData);
		} catch (error) {
			throw pocketBaseRequestError(error, 'uploadImagesToPocketBase(_integratedAiImages.create)');
		}

		const url = pocketbaseClient.files.getURL(record, record.file);
		const websiteDomain = String(process.env.WEBSITE_DOMAIN || '').trim();
		if (!websiteDomain) {
			return url;
		}

		return url.replace(/^https?:\/\/[^/]+/i, `https://${websiteDomain}/hcgi/platform`);
	});

	return Promise.all(uploadPromises);
}

/**
 * Resolve Integrated AI proxy settings from process env (apps/api/.env via Docker env_file).
 * Never hardcode the generate URL.
 *
 * @returns {{ baseUrl: string, apiKey: string, websiteId: string, proxyEntranceId: string }}
 */
function resolveIntegratedAiProxyConfig() {
	const baseUrl = getEnv('INTEGRATED_AI_API_URL').replace(/\/+$/, '');
	const apiKey = getEnv('INTEGRATED_AI_API_KEY');
	const websiteId = getEnv('WEBSITE_ID');
	const proxyEntranceId = getEnv('PROXY_ENTRANCE_ID');

	const missing = [];
	if (!baseUrl) missing.push('INTEGRATED_AI_API_URL');
	if (!apiKey) missing.push('INTEGRATED_AI_API_KEY');
	if (!websiteId) missing.push('WEBSITE_ID');

	if (missing.length > 0) {
		const error = new Error(
			`Integrated AI is not configured. Missing environment variable(s): ${missing.join(', ')}. `
			+ 'Set them in apps/api/.env (loaded by docker-compose.prod.yml env_file for the api service).',
		);
		error.status = 503;
		error.errorCode = 'INTEGRATED_AI_NOT_CONFIGURED';
		throw error;
	}

	try {
		// Validate absolute URL before fetch — avoids TypeError: Failed to parse URL from undefined/generate
		const parsed = new URL(baseUrl);
		if (!['http:', 'https:'].includes(parsed.protocol)) {
			throw new Error('protocol must be http or https');
		}
	} catch (cause) {
		const error = new Error(
			`INTEGRATED_AI_API_URL is invalid (${baseUrl}). Set a full absolute URL in apps/api/.env.`,
		);
		error.status = 503;
		error.errorCode = 'INTEGRATED_AI_URL_INVALID';
		error.cause = cause;
		throw error;
	}

	return { baseUrl, apiKey, websiteId, proxyEntranceId };
}

/**
 * Sends a message to the AI proxy and pipes SSE events to the client.
 * Assistant message is saved to PocketBase when the stream ends.
 * This method should be used for text/text, image/text, image/image, text/image combinations.
 *
 * @param {{ userId: string, systemPrompt: string, userMessage: ContentBlock[] }} params
 * @returns {Promise<import('node:stream').Readable>}
 */
export async function stream({ userId, systemPrompt, userMessage }) {
	const history = await getHistory({ userId });
	const { baseUrl, apiKey, websiteId, proxyEntranceId } = resolveIntegratedAiProxyConfig();
	const generateUrl = `${baseUrl}/generate`;

	const response = await fetch(generateUrl, {
		method: 'POST',
		headers: {
			'Accept': 'text/event-stream',
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${apiKey}`,
			...(proxyEntranceId && { 'X-Proxy-Entrance-Id': proxyEntranceId }),
		},
		body: JSON.stringify({
			website_id: websiteId,
			history: [
				...history,
				mapUserMessage({ message: userMessage }),
			],
			system_prompt: systemPrompt,
			stream: true,
			environment: process.env.NODE_ENV === NodeEnv.Production ? 'prod' : 'dev',
		}),
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => 'Unknown error');
		throw new Error(`AI proxy request failed with status ${response.status}: ${errorBody}`);
	}

	const [clientStream, historyStream] = response.body.tee();
	const passThrough = new PassThrough();

	Readable.fromWeb(clientStream).pipe(passThrough, { end: false });

	processStream({ userId, stream: historyStream, userMessage }).catch((error) => {
		logger.error('Failed to process stream', error);
		passThrough.push(`data: ${JSON.stringify({ type: SSEEventType.Error, data: { content: error.message } })}\n\n`);
	}).finally(() => {
		passThrough.end(`data: ${JSON.stringify({ type: SSEEventType.Completed, data: { content: '[COMPLETED]' } })}\n\n`);
	});

	return passThrough;
}

/**
 * Consumes an SSE stream branch, parses history-relevant events,
 * and saves the assistant message to PocketBase.
 *
 * @param {{ userId: string, stream: ReadableStream, userMessage: ContentBlock[] }} params
 * @returns {Promise<void>}
 */
async function processStream({ userId, stream, userMessage }) {
	const events = await parseSSEEvents({ stream });
	const historyEvents = events.filter(event => HistoryEventTypes.has(event.type));
	const squashedHistoryEvents = squashSSEEvents({ events: historyEvents });

	await saveMessages({ userId, messages: [
		{
			role: MessageRole.User,
			content: userMessage,
		},
		{
			role: MessageRole.Assistant,
			content: squashedHistoryEvents,
		},
	] });
}

/**
 * Parses SSE events from a ReadableStream.
 *
 * @param {{ stream: ReadableStream }} params
 * @returns {Promise<SSEEvent[]>}
 */
async function parseSSEEvents({ stream }) {
	/** @type {SSEEvent[]} */
	const events = [];
	let buffer = '';

	const textStream = stream.pipeThrough(new TextDecoderStream());

	for await (const chunk of textStream) {
		buffer += chunk;
		const lines = buffer.split('\n');
		buffer = lines.pop() || '';

		for (const line of lines) {
			if (!line.startsWith('data: ')) {
				continue;
			}

			const jsonStr = line.slice(6);

			if (jsonStr === '[DONE]') {
				return events;
			}

			/** @type {SSEEvent} */
			const event = JSON.parse(jsonStr);

			if (event.type === SSEEventType.Error) {
				throw new Error(event.data.content);
			}

			events.push(event);
		}
	}

	return events;
}

/**
 * @param {{ userId: string, messages: { role: typeof MessageRole[keyof typeof MessageRole], content: string }[] }} params
 * @returns {Promise<object>}
 */
async function saveMessages({ userId, messages }) {
	const batch = pocketbaseClient.createBatch();

	messages.map(message => batch.collection('_integratedAiMessages').create({
		...(userId && { userId }),
		role: message.role,
		content: message.content,
	}));

	try {
		await batch.send();
	} catch (error) {
		throw pocketBaseRequestError(error, 'saveMessages(_integratedAiMessages.batchCreate)');
	}
}

/**
 * Fetches message history and maps it to HistoryMessage format.
 *
 * @param {{ userId: string }} params
 * @returns {Promise<HistoryMessage[]>}
 */
export async function getHistory({ userId }) {
	if (!userId) {
		return [];
	}

	const filter = pocketbaseClient.filter('userId = {:userId}', { userId });
	let result;
	try {
		result = await pocketbaseClient.collection('_integratedAiMessages').getList(1, MAX_HISTORY_MESSAGES, {
			sort: '-created',
			filter,
			requestKey: null,
		});
	} catch (error) {
		throw pocketBaseRequestError(
			error,
			`getHistory(_integratedAiMessages.getList filter=${filter} sort=-created)`,
		);
	}

	const records = result.items.reverse();

	/** @type {HistoryMessage[]} */
	const historyMessages = [];

	for (const record of records) {
		if (record.role === MessageRole.User) {
			historyMessages.push(mapUserMessage({ message: record.content }));
			continue;
		}

		historyMessages.push(...mapAssistantMessages({ message: record.content }));
	}

	return historyMessages;
}

/**
 * @param {{ message: ContentBlock[] }} params
 * @returns {HistoryMessage}
 */
function mapUserMessage({ message }) {
	const textParts = message.filter(b => b.type === ContentBlockType.Text).map(b => b.text);
	const images = message.filter(b => b.type === ContentBlockType.Image).map(b => b.image);

	return {
		role: MessageRole.User,
		content: textParts.join('\n'),
		...(images.length > 0 && { images }),
	};
}

/**
 * @param {{ message: SSEEventHistory[] }} params
 * @returns {HistoryMessage[]}
 */
function mapAssistantMessages({ message }) {
	/** @type {HistoryMessage[]} */
	const messages = [];

	for (const event of message) {
		const agentName = event?.metadata?.agent_name;

		if (event.type === SSEEventType.ToolResult) {
			messages.push({
				role: MessageRole.Tool,
				tool_call_id: event.data.tool_call_id,
				content: event.data.content,
				...(agentName && { agent_name: agentName }),
			});
			continue;
		}

		messages.push({
			role: MessageRole.Assistant,
			content: event.data.content,
			...(event.type === SSEEventType.ToolUse && {
				tool_calls: event.data.tool_calls.map(toolCall => ({
					id: toolCall.id,
					type: 'function',
					function: {
						name: toolCall.name,
						arguments: JSON.stringify(toolCall.input),
					},
				})),
			}),
			...(agentName && { agent_name: agentName }),
		});
	}

	return messages;
}

function squashSSEEvents({ events }) {
	if (!events.length) {
		return events;
	}

	/** @type {SSEEventHistory[]} */
	const squashedEvents = [];
	let [currentEvent, ...restEvents] = events;

	restEvents.forEach((event) => {
		if (!SquashableSSEEventTypes.has(currentEvent.type) || !SquashableSSEEventTypes.has(event.type) || event.type !== currentEvent.type) {
			squashedEvents.push(currentEvent);
			currentEvent = event;
			return;
		}

		currentEvent = {
			...currentEvent,
			data: {
				...currentEvent.data,
				content: `${currentEvent.data.content}${event.data.content}`,
			},
		};
	});

	squashedEvents.push(currentEvent);

	return squashedEvents;
}
