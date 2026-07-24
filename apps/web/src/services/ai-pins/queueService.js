/**
 * QueueService — Add to Queue using Workspace Config smart slots.
 */

import { resolvePublishingConfig } from './publishingConfig.js';
import { allocateSmartSlots } from './smartSlot.js';
import { schedulePins } from './scheduleService.js';
import { fetchScheduledJobs } from './publishingService.js';

/**
 * Load occupied slots from existing scheduled jobs (feeds Calendar).
 */
export async function loadOccupiedSlots() {
	const jobs = await fetchScheduledJobs({ status: 'scheduled', perPage: 200 });
	return jobs
		.map((job) => job.scheduledAt)
		.filter(Boolean);
}

/**
 * Compute next smart queue slot(s) from Workspace Config + current queue.
 */
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

/**
 * Add pins to the smart queue — schedules at next available slots.
 * One slot per pin (staggered by interval / daily limits).
 */
export async function addPinsToQueue({
	config,
	pinIds,
	accountId,
	boardId,
	perPinTargets,
	onSlotResolved,
}) {
	if (!Array.isArray(pinIds) || pinIds.length === 0) {
		throw new Error('Select at least one pin for the queue');
	}
	if (!accountId) throw new Error('Select a Pinterest account');
	if (!boardId) throw new Error('Select a Pinterest board');

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
		message: `${pinIds.length} pin(s) added to smart queue`,
	};
}
