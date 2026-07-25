import { useRef, useSyncExternalStore } from 'react';
import { getGalleryState, subscribeGallery } from '@/services/templates/galleryStore';

/**
 * Selector-aware gallery subscription — skip re-render when selected slice is Object.is-equal.
 */
export function useGalleryStore(selector = (s) => s) {
	const selectorRef = useRef(selector);
	selectorRef.current = selector;
	const lastRef = useRef({ state: null, selected: null });

	return useSyncExternalStore(
		subscribeGallery,
		() => {
			const nextState = getGalleryState();
			const nextSelected = selectorRef.current(nextState);
			if (
				lastRef.current.state === nextState
				|| Object.is(lastRef.current.selected, nextSelected)
			) {
				if (lastRef.current.state !== nextState) {
					lastRef.current = { state: nextState, selected: nextSelected };
				}
				return lastRef.current.selected;
			}
			lastRef.current = { state: nextState, selected: nextSelected };
			return nextSelected;
		},
		() => selectorRef.current(getGalleryState()),
	);
}
