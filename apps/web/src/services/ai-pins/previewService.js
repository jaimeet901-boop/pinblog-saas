/**
 * PreviewService — build a publish preview model (no React).
 * Design Library hook point: resolveTemplatePreview can be swapped later.
 */

/**
 * Future Design Library integration seam.
 * For now returns null — UI shows a placeholder "Choose Template" button.
 */
export function openDesignLibraryChooser({ onSelect } = {}) {
	return {
		available: false,
		message: 'Design Library is coming soon. Template selection will plug in here without refactoring.',
		onSelect: typeof onSelect === 'function' ? onSelect : null,
	};
}

/**
 * Build preview DTO for a pin before publish.
 */
export function buildPinPreview({
	pin,
	account,
	board,
	websiteUrl = '',
	article,
}) {
	const url = websiteUrl
		|| article?.url
		|| pin?.websiteUrl
		|| '';

	return {
		id: pin?.id || pin?.tempId || '',
		imageUrl: pin?.imageUrl || '',
		title: pin?.title || 'Untitled pin',
		description: pin?.description || '',
		overlayText: pin?.overlayText || '',
		boardId: board?.boardId || pin?.boardId || '',
		boardName: board?.name || pin?.boardName || 'No board selected',
		accountId: account?.id || pin?.accountId || '',
		accountLabel: account?.label || account?.accountName || account?.username || pin?.accountLabel || 'No account',
		websiteUrl: url,
		status: pin?.status || 'draft',
		scheduledAt: pin?.scheduledAt || '',
		templateName: pin?.templateName || '',
	};
}

export function validatePreviewReady(preview) {
	const errors = [];
	if (!preview?.imageUrl) errors.push('Image is required');
	if (!String(preview?.title || '').trim()) errors.push('Title is required');
	if (!preview?.boardId) errors.push('Pinterest board is required');
	if (!preview?.accountId) errors.push('Pinterest account is required');
	return {
		ok: errors.length === 0,
		errors,
	};
}
