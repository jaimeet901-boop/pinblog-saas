import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/apiServerClient', () => ({
	default: {
		fetch: vi.fn(),
	},
}));

import apiServerClient from '@/lib/apiServerClient';
import { fetchGalleryPage } from '@/services/templates/templatesApi';

describe('templatesApi gallery channel', () => {
	beforeEach(() => {
		vi.mocked(apiServerClient.fetch).mockReset();
		vi.mocked(apiServerClient.fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ items: [], totalItems: 0, hasMore: false }),
		});
	});

	it('passes channel query param to gallery API', async () => {
		await fetchGalleryPage({ channel: 'pinterest', page: 1, perPage: 24 });
		const url = vi.mocked(apiServerClient.fetch).mock.calls[0][0];
		expect(url).toContain('channel=pinterest');
		expect(url).toContain('view=gallery');
	});

	it('passes facebook channel for Facebook gallery', async () => {
		await fetchGalleryPage({ channel: 'facebook', page: 1 });
		const url = vi.mocked(apiServerClient.fetch).mock.calls[0][0];
		expect(url).toContain('channel=facebook');
	});
});
