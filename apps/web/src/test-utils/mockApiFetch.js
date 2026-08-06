/**
 * Shared vitest helpers for API fetch mocks (F8-1).
 * Keeps Response-like stubs consistent across ai-pins integration tests.
 */

/**
 * @param {{ ok?: boolean, status?: number, body?: unknown }} [options]
 */
export function mockJsonResponse({ ok = true, status = 200, body = {} } = {}) {
	return {
		ok,
		status,
		json: async () => body,
	};
}

/**
 * Configure a vi.fn fetch mock to return responses in order.
 *
 * @param {import('vitest').Mock} fetchMock
 * @param {Array<{ ok?: boolean, status?: number, body?: unknown }>} responses
 */
export function mockFetchSequence(fetchMock, responses = []) {
	responses.forEach((response) => {
		fetchMock.mockResolvedValueOnce(mockJsonResponse(response));
	});
}

/**
 * PocketBase client module mock with auth header support for draftService tests.
 *
 * @param {typeof import('vitest')['vi']} vi
 * @param {{ includeGetFullList?: boolean }} [options]
 */
export function buildPocketbaseClientMock(vi, options = {}) {
	const create = vi.fn();
	const getOne = vi.fn();
	const update = vi.fn();
	const getFullList = vi.fn();
	const collection = {
		create,
		getOne,
		update,
		...(options.includeGetFullList ? { getFullList } : {}),
	};

	return {
		default: {
			authStore: {
				record: { id: 'user_1' },
				token: 'test-token',
			},
			collection: vi.fn(() => collection),
			__mocks: {
				create,
				getOne,
				update,
				...(options.includeGetFullList ? { getFullList } : {}),
			},
		},
		getPocketbaseAuthHeader: () => 'Bearer test-auth',
	};
}

/**
 * Stub compositor image loader for export/generation pipeline tests.
 */
export function mockCompositorImageLoader() {
	return async () => ({ width: 1000, height: 900 });
}

/**
 * Standard export runtime options for mock-surface pipeline tests.
 *
 * @param {typeof import('../lib/pinLayerCompositor.js').createMockRenderSurface} createMockRenderSurface
 */
export function mockExportRuntime(createMockRenderSurface) {
	return {
		createSurface: createMockRenderSurface,
		loadImageFn: mockCompositorImageLoader(),
	};
}
