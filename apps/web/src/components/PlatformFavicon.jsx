import { useEffect } from 'react';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';
import { resolveHttpUrl } from '@/lib/platformIdentity';

export const DEFAULT_FAVICON_HREF = '/vite.svg';

function faviconType(href) {
	const lower = String(href || '').toLowerCase();
	if (lower.includes('.png')) return 'image/png';
	if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg';
	if (lower.includes('.webp')) return 'image/webp';
	if (lower.includes('.ico')) return 'image/x-icon';
	return 'image/svg+xml';
}

/**
 * Applies Platform Identity favicon globally.
 * Fallback: /vite.svg (existing static asset) when branding.faviconUrl is empty.
 */
export default function PlatformFavicon() {
	const { faviconUrl } = usePlatformIdentity();

	useEffect(() => {
		const href = resolveHttpUrl(faviconUrl) || DEFAULT_FAVICON_HREF;
		let link = document.querySelector("link[rel='icon']");
		if (!link) {
			link = document.createElement('link');
			link.setAttribute('rel', 'icon');
			document.head.appendChild(link);
		}
		link.setAttribute('href', href);
		link.setAttribute('type', faviconType(href));
	}, [faviconUrl]);

	return null;
}
