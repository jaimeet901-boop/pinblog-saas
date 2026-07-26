import process from 'node:process';
import { PassThrough } from 'node:stream';
import logger from '../utils/logger.js';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { getPublicFileUrl } from '../utils/public-file-url.js';
import { streamTextWithRegistry } from '../services/text-providers/index.js';

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

		return getPublicFileUrl(record, record.file);
	});

	return Promise.all(uploadPromises);
}

/**
 * Sends a message through the Admin Provider Registry text adapter (Gemini first)
 * and pipes SSE events to the client in the existing frontend contract.
 * Assistant message is saved to PocketBase when the stream ends.
 * Does not use INTEGRATED_AI_API_URL.
 *
 * @param {{ userId: string, systemPrompt: string, userMessage: ContentBlock[] }} params
 * @returns {Promise<import('node:stream').Readable>}
 */
export async function stream({ userId, systemPrompt, userMessage }) {
	const history = await getHistory({ userId });
	const currentUser = mapUserMessage({ message: userMessage });
	const messages = [...history, currentUser];

	const passThrough = new PassThrough();

	(async () => {
		/** @type {SSEEventHistory[]} */
		const contentEvents = [];
		let providerLabel = 'text-provider';

		try {
			for await (const chunk of streamTextWithRegistry({
				systemPrompt,
				messages,
			})) {
				if (chunk.provider?.name || chunk.provider?.code) {
					providerLabel = chunk.provider.name || chunk.provider.code;
				}

				const event = {
					type: SSEEventType.Content,
					data: { content: chunk.text },
					metadata: { agent_name: providerLabel },
				};
				contentEvents.push(event);
				passThrough.write(`data: ${JSON.stringify(event)}\n\n`);
			}

			const squashedHistoryEvents = squashSSEEvents({ events: contentEvents });
			await saveMessages({
				userId,
				messages: [
					{
						role: MessageRole.User,
						content: userMessage,
					},
					{
						role: MessageRole.Assistant,
						content: squashedHistoryEvents,
					},
				],
			}).catch((error) => {
				logger.error('Failed to persist integrated-ai history', error);
			});
		} catch (error) {
			logger.error('Text provider stream failed', error);
			const message = error?.message || 'Text generation failed';
			passThrough.write(`data: ${JSON.stringify({
				type: SSEEventType.Error,
				data: { content: message },
			})}\n\n`);
		} finally {
			passThrough.end(`data: ${JSON.stringify({
				type: SSEEventType.Completed,
				data: { content: '[COMPLETED]' },
			})}\n\n`);
		}
	})();

	return passThrough;
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
