import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
	listImplementedTextAdapters,
	listRegisteredTextAdapters,
	isImplementedTextAdapter,
} from './adapters.js';
import { buildTextProviderFailoverChain } from './selection.js';
import { estimateTokenCount, isFailoverableTextError } from './contract.js';
import {
	normalizeProviderCapabilities,
	providerSupportsRequestType,
} from './capabilities.js';
import {
	DEFAULT_RUNTIME_PRIORITY,
	normalizeRuntimePriorityList,
	orderProvidersByRuntimePriority,
	resolveRuntimePriorityOrder,
} from './priority.js';
import {
	recordRuntimeRequestOutcome,
	resetRuntimeHealthStateForTests,
	getRuntimeHealthState,
} from './health-state.js';
import { estimateRequestCostUsd, estimateTokenUsage } from './cost.js';

describe('text-providers adapters', () => {
	it('implements gemini and openai', () => {
		const adapters = listImplementedTextAdapters();
		assert.ok(adapters.includes('gemini'));
		assert.ok(adapters.includes('openai'));
		assert.equal(isImplementedTextAdapter('gemini'), true);
		assert.equal(isImplementedTextAdapter('claude'), false);
	});

	it('registers placeholders for remaining providers', () => {
		const registered = listRegisteredTextAdapters();
		for (const code of ['claude', 'openrouter', 'deepseek', 'replicate', 'ollama', 'huggingface']) {
			assert.ok(registered.includes(code), `missing placeholder ${code}`);
		}
	});
});

describe('provider capabilities', () => {
	it('exposes the required capability fields', () => {
		const caps = normalizeProviderCapabilities('openai');
		for (const key of [
			'text', 'image', 'streaming', 'vision', 'embeddings',
			'functionCalling', 'maxTokens', 'supportedModels',
		]) {
			assert.ok(Object.prototype.hasOwnProperty.call(caps, key), key);
		}
		assert.equal(caps.text, true);
		assert.equal(caps.streaming, true);
		assert.ok(Array.isArray(caps.supportedModels));
	});

	it('maps request types to capabilities', () => {
		const caps = normalizeProviderCapabilities('gemini');
		assert.equal(providerSupportsRequestType(caps, 'text'), true);
		assert.equal(providerSupportsRequestType(caps, 'stream'), true);
		assert.equal(providerSupportsRequestType(caps, 'vision'), true);
	});
});

describe('runtime priority', () => {
	it('normalizes and resolves admin priority order', () => {
		assert.deepEqual(
			normalizeRuntimePriorityList(['OpenAI', 'gemini', 'openai', '']),
			['openai', 'gemini'],
		);
		assert.deepEqual(
			resolveRuntimePriorityOrder({ runtimePriority: ['gemini', 'openai'] }),
			['gemini', 'openai'],
		);
		assert.ok(DEFAULT_RUNTIME_PRIORITY.includes('openai'));
	});

	it('orders providers by runtimePriority', () => {
		const ordered = orderProvidersByRuntimePriority(
			[
				{ code: 'deepseek', priority: 1 },
				{ code: 'openai', priority: 50 },
				{ code: 'gemini', priority: 2 },
			],
			{ runtimePriority: ['openai', 'gemini', 'claude', 'openrouter', 'deepseek'] },
		);
		assert.deepEqual(ordered.map((item) => item.code), ['openai', 'gemini', 'deepseek']);
	});
});

describe('selection pipeline', () => {
	beforeEach(() => {
		resetRuntimeHealthStateForTests();
	});

	it('filters by capability → enabled → configured → healthy → priority', () => {
		const providers = [
			{
				code: 'openai',
				name: 'OpenAI',
				enabled: true,
				config: { hasApiKey: true },
				health: 'healthy',
				priority: 20,
			},
			{
				code: 'gemini',
				name: 'Google Gemini',
				enabled: true,
				config: { hasApiKey: true },
				health: 'healthy',
				priority: 10,
			},
			{
				code: 'claude',
				name: 'Claude',
				enabled: true,
				config: { hasApiKey: true },
				health: 'healthy',
				priority: 5,
			},
		];

		const chain = buildTextProviderFailoverChain(providers, {
			runtimePriority: ['openai', 'gemini', 'claude', 'openrouter', 'deepseek'],
		}, { requestType: 'text' });

		// Claude is placeholder (not implemented) so excluded from live chain
		assert.deepEqual(chain.map((item) => item.code), ['openai', 'gemini']);
	});

	it('skips disabled and unconfigured providers', () => {
		const chain = buildTextProviderFailoverChain([
			{
				code: 'openai',
				enabled: false,
				config: { hasApiKey: true },
				health: 'healthy',
			},
			{
				code: 'gemini',
				enabled: true,
				config: { hasApiKey: false },
				health: 'healthy',
			},
		], { runtimePriority: ['openai', 'gemini'] });
		assert.deepEqual(chain, []);
	});

	it('prefers healthy providers when mixed', () => {
		recordRuntimeRequestOutcome('openai', { ok: false, errorMessage: 'down' });
		recordRuntimeRequestOutcome('gemini', { ok: true, latencyMs: 40 });

		const chain = buildTextProviderFailoverChain([
			{
				code: 'openai',
				enabled: true,
				config: { hasApiKey: true },
				health: 'degraded',
			},
			{
				code: 'gemini',
				enabled: true,
				config: { hasApiKey: true },
				health: 'healthy',
			},
		], { runtimePriority: ['openai', 'gemini'] });

		assert.deepEqual(chain.map((item) => item.code), ['gemini']);
		assert.equal(getRuntimeHealthState('openai').healthy, false);
	});
});

describe('runtime logging helpers', () => {
	it('estimates tokens and cost', () => {
		const tokens = estimateTokenUsage({
			systemPrompt: 'sys',
			messages: [{ role: 'user', content: 'hello world' }],
			outputText: 'response text here',
		});
		assert.ok(tokens.total > 0);
		assert.ok(estimateRequestCostUsd('openai', tokens) >= 0);
		assert.ok(estimateTokenCount('abcd') >= 1);
	});

	it('marks rate limits and timeouts as failoverable', () => {
		assert.equal(isFailoverableTextError(Object.assign(new Error('rate limit'), { status: 429 })), true);
		assert.equal(isFailoverableTextError(Object.assign(new Error('timeout'), { status: 504 })), true);
		assert.equal(isFailoverableTextError(Object.assign(new Error('bad request'), { status: 400 })), false);
	});
});
