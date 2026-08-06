/**
 * Facebook queue scheduling via smart slots + /facebook/schedule.
 */

import { resolvePublishingConfig } from '@/services/ai-pins/publishingConfig.js';
import { allocateSmartSlots } from '@/services/ai-pins/smartSlot.js';
import { schedulePins } from './scheduleService.js';
import { fetchScheduledJobs } from './publishingService.js';

export async function loadOccupiedSlots() {
	const jobs = await fetchScheduledJobs({ status: 'scheduled', perPage: 200 });
	return jobs
		.map((job) => job.scheduledAt)
		.filter(Boolean);
}

export async function planQueueSlots(config, pinCount = 1) {
	const publishingConfig = resolvePublishingConfig(config);
	if (publishingConfig.schedulingMode === 'immediate') {
		const now = new Date(Date.now() + 35_000);
		return {
			publishingConfig,
			slots: Array.from({ length: pinCount }, () => ({
				scheduledAt: now.toISOString(),
				localLabel: 'immediate',
				timezone: publishingConfig.timezone,
			})),
		};
	}

	const occupied = await loadOccupiedSlots();
	const slots = allocateSmartSlots(publishingConfig, pinCount, occupied);
	return { publishingConfig, slots };
}

export async function addPinsToQueue({
	config,
	pinIds,
	accountId,
	boardId,
	perPinTargets,
	onSlotResolved,
}) {
	if (!Array.isArray(pinIds) || pinIds.length === 0) {
		throw new Error('Select at least one post for the queue');
	}
	if (!accountId) throw new Error('Select a Facebook account');
	if (!boardId) throw new Error('Select a Facebook Page');

	const { publishingConfig, slots } = await planQueueSlots(config, pinIds.length);
	onSlotResolved?.({ publishingConfig, slots });

	const jobs = [];
	for (let i = 0; i < pinIds.length; i += 1) {
		const slot = slots[i] || slots[slots.length - 1];
		const result = await schedulePins({
			pinIds: [pinIds[i]],
			accountId,
			boardId,
			timezone: publishingConfig.timezone,
			scheduledAt: slot.scheduledAt,
			perPinTargets,
		});
		jobs.push(...(result.jobs || []));
	}

	return {
		jobs,
		slots,
		publishingConfig,
		message: `${pinIds.length} post(s) added to smart queue`,
	};
}
