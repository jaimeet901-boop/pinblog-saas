import { useEffect, useState } from 'react';

/**
 * Minimal image loader for Konva (avoids extra use-image dependency).
 */
export default function useHtmlImage(url) {
	const [image, setImage] = useState(null);

	useEffect(() => {
		if (!url || String(url).includes('{{')) {
			setImage(null);
			return undefined;
		}
		let cancelled = false;
		const img = new window.Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			if (!cancelled) setImage(img);
		};
		img.onerror = () => {
			if (!cancelled) setImage(null);
		};
		img.src = url;
		return () => {
			cancelled = true;
		};
	}, [url]);

	return [image];
}
