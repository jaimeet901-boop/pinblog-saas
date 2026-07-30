import { useEffect, useMemo, useState } from 'react';
import apiServerClient from '@/lib/apiServerClient';
import { useWorkspaceConfig } from '@/context/WorkspaceConfigContext';
import {
	PLATFORM_IDENTITY_DEFAULTS,
	pickPlatformIdentity,
} from '@/lib/platformIdentity';
import { resolvePlatformSeo } from '@/lib/platformSeo';

/**
 * Resolves Platform Identity for shell + public consumers.
 * Prefers workspace config when available; otherwise public /platform/identity.
 * Always fails safe to Chef IA defaults.
 */
export function usePlatformIdentity() {
	const { config, hasValidConfig } = useWorkspaceConfig();
	const [publicIdentity, setPublicIdentity] = useState(null);

	useEffect(() => {
		if (hasValidConfig) return undefined;

		let cancelled = false;
		(async () => {
			try {
				const response = await apiServerClient.fetch('/platform/identity');
				if (!response.ok) return;
				const data = await response.json();
				if (!cancelled && data && typeof data === 'object') {
					setPublicIdentity(data);
				}
			} catch {
				/* keep defaults */
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [hasValidConfig]);

	if (hasValidConfig) {
		return pickPlatformIdentity(config);
	}
	if (publicIdentity) {
		return pickPlatformIdentity(publicIdentity);
	}
	return { ...PLATFORM_IDENTITY_DEFAULTS, seo: { ...PLATFORM_IDENTITY_DEFAULTS.seo } };
}

/**
 * Resolved SEO Identity (with inheritance chains).
 */
export function usePlatformSeo(overrides = {}) {
	const identity = usePlatformIdentity();
	return useMemo(
		() => resolvePlatformSeo(identity, overrides),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- overrides compared by JSON for page objects
		[identity, JSON.stringify(overrides)],
	);
}

/**
 * Sets document.title from SEO Identity browser-title chain.
 */
export function usePlatformDocumentTitle(overrides = {}, { enabled = true } = {}) {
	const seo = usePlatformSeo(
		typeof overrides === 'string' ? { browserTitle: overrides } : (overrides || {}),
	);

	useEffect(() => {
		if (!enabled) return undefined;
		const next = String(seo.browserTitle || '').trim();
		if (!next) return undefined;
		const previous = document.title;
		document.title = next;
		return () => {
			if (document.title === next) {
				document.title = previous;
			}
		};
	}, [seo.browserTitle, enabled]);
}
