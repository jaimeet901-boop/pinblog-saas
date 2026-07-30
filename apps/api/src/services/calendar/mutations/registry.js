/**
 * Default mutation adapter registry.
 * Add future channel adapters here without changing the router core.
 */

import { createLiveFacebookMutationAdapter } from './adapters/facebook-live.js';
import { createLivePinterestMutationAdapter } from './adapters/pinterest-live.js';
import { createLiveWordpressMutationAdapter } from './adapters/wordpress-live.js';

export function createDefaultMutationAdapters() {
	return [
		createLivePinterestMutationAdapter(),
		createLiveWordpressMutationAdapter(),
		createLiveFacebookMutationAdapter(),
	];
}
