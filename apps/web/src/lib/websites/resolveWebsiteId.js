/**
 * Keep the previously-selected websiteId when it still exists in the newly-loaded
 * websites list. Otherwise, fall back to the first website.
 */
export function resolveWebsiteId(previousWebsiteId, websites) {
	const list = Array.isArray(websites) ? websites : [];
	if (list.length === 0) return '';

	if (previousWebsiteId && list.some((site) => String(site?.id) === String(previousWebsiteId))) {
		return previousWebsiteId;
	}

	return list[0].id;
}
