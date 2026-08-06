import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/apiServerClient', () => ({
	default: {
		fetch: vi.fn(),
	},
}));

import apiServerClient from '@/lib/apiServerClient';
import { FACEBOOK_CHANNEL_CAPABILITIES } from '@/lib/facebook/channelCapabilities.js';
import {
	cancelFacebookJob,
	publishNow,
	publishNowFacebookJob,
	retryFacebookJob,
	rescheduleFacebookJob,
	schedulePins,
} from '@/services/ai-facebook';
import {
	facebookDestinationAdapter,
	getDestinationAdapter,
} from '@/services/studio/destinationAdapters.js';

function mockJsonResponse(status, body) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	};
}

describe('facebook F5-6 channel capabilities', () => {
	it('enables schedule and publishNow while keeping history disabled', () => {
		expect(FACEBOOK_CHANNEL_CAPABILITIES.schedule).toBe(true);
		expect(FACEBOOK_CHANNEL_CAPABILITIES.publishNow).toBe(true);
		expect(FACEBOOK_CHANNEL_CAPABILITIES.queueImplemented).toBe(true);
		expect(FACEBOOK_CHANNEL_CAPABILITIES.publishingHistory).toBe(false);
		expect(FACEBOOK_CHANNEL_CAPABILITIES.insights).toBe(false);
		expect(FACEBOOK_CHANNEL_CAPABILITIES.studioPromptPack).toBe(true);
		expect(FACEBOOK_CHANNEL_CAPABILITIES.studioTemplatePack).toBe(true);
		expect(FACEBOOK_CHANNEL_CAPABILITIES.studioExportProfiles).toBe(true);
	});
});

describe('facebook destination adapter', () => {
	beforeEach(() => {
		vi.mocked(apiServerClient.fetch).mockReset();
	});

	it('returns facebook adapter with live channel capabilities', () => {
		const adapter = getDestinationAdapter('facebook');
		expect(adapter.id).toBe('facebook');
		expect(adapter.channelCapabilities.schedule).toBe(true);
		expect(adapter.schedulePins).toBeTypeOf('function');
		expect(adapter.runPublishNowFlow).toBeTypeOf('function');
		expect(adapter.cancelJob).toBeTypeOf('function');
	});

	it('does not expose FACEBOOK_API_MISSING stubs', () => {
		expect(String(facebookDestinationAdapter.publishNow)).not.toMatch(/FACEBOOK_API_MISSING/);
		expect(String(facebookDestinationAdapter.schedulePins)).not.toMatch(/FACEBOOK_API_MISSING/);
	});
});

describe('facebook studio scheduling flow', () => {
	beforeEach(() => {
		vi.mocked(apiServerClient.fetch).mockReset();
	});

	it('calls POST /facebook/schedule with aiPinIds and pageId', async () => {
		vi.mocked(apiServerClient.fetch).mockResolvedValueOnce(
			mockJsonResponse(201, { jobs: [{ id: 'job_1', status: 'scheduled' }] }),
		);

		const result = await schedulePins({
			pinIds: ['pin_1', 'pin_2'],
			accountId: 'acc_1',
			boardId: 'page_123',
			timezone: 'UTC',
			scheduledAt: '2026-08-10T12:00:00.000Z',
			perPinTargets: {
				pin_2: { accountId: 'acc_2', boardId: 'page_456' },
			},
		});

		expect(result.jobs).toHaveLength(1);
		const [path, options] = vi.mocked(apiServerClient.fetch).mock.calls[0];
		expect(path).toBe('/facebook/schedule');
		expect(options.method).toBe('POST');
		const body = JSON.parse(String(options.body));
		expect(body.aiPinIds).toEqual(['pin_1', 'pin_2']);
		expect(body.pageId).toBe('page_123');
		expect(body.perPinTargets.pin_2.pageId).toBe('page_456');
	});

	it('calls POST /facebook/publish once per pin', async () => {
		vi.mocked(apiServerClient.fetch)
			.mockResolvedValueOnce(mockJsonResponse(201, { id: 'job_1', status: 'scheduled' }))
			.mockResolvedValueOnce(mockJsonResponse(201, { id: 'job_2', status: 'scheduled' }));

		const result = await publishNow({
			pinIds: ['pin_1', 'pin_2'],
			accountId: 'acc_1',
			boardId: 'page_123',
			timezone: 'UTC',
		});

		expect(result.jobs).toHaveLength(2);
		expect(vi.mocked(apiServerClient.fetch).mock.calls[0][0]).toBe('/facebook/publish');
		expect(vi.mocked(apiServerClient.fetch).mock.calls[1][0]).toBe('/facebook/publish');
	});
});

describe('facebook job mutations', () => {
	beforeEach(() => {
		vi.mocked(apiServerClient.fetch).mockReset();
	});

	it('calls cancel, retry, publish-now, and reschedule routes', async () => {
		vi.mocked(apiServerClient.fetch)
			.mockResolvedValueOnce(mockJsonResponse(200, { ok: true, job: { id: 'job_1' } }))
			.mockResolvedValueOnce(mockJsonResponse(200, { ok: true, job: { id: 'job_1' } }))
			.mockResolvedValueOnce(mockJsonResponse(200, { ok: true, job: { id: 'job_1' } }))
			.mockResolvedValueOnce(mockJsonResponse(200, { id: 'job_1', status: 'scheduled' }));

		await cancelFacebookJob('job_1');
		await retryFacebookJob('job_1');
		await publishNowFacebookJob('job_1');
		await rescheduleFacebookJob('job_1', {
			scheduledAt: '2026-08-10T12:00:00.000Z',
			timezone: 'UTC',
		});

		expect(vi.mocked(apiServerClient.fetch).mock.calls.map(([path, options]) => [path, options?.method])).toEqual([
			['/facebook/jobs/job_1/cancel', 'POST'],
			['/facebook/jobs/job_1/retry', 'POST'],
			['/facebook/jobs/job_1/publish-now', 'POST'],
			['/facebook/jobs/job_1', 'PATCH'],
		]);
	});
});
