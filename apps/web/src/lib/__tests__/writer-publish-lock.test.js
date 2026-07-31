import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	createPublishLock,
	runWithPublishLock,
	simulateConcurrentPublishClicks,
} from '../writer-publish-lock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const writerPagePath = path.resolve(here, '../../pages/app/WriterPage.jsx');
const scheduleModalPath = path.resolve(here, '../../components/writer/WriterScheduleModal.jsx');

describe('High Priority #3 — Writer publish/schedule double-submit lock', () => {
	it('double-click Publish triggers one request', async () => {
		let runs = 0;
		const summary = await simulateConcurrentPublishClicks(2, async () => {
			runs += 1;
			await new Promise((r) => setTimeout(r, 20));
			return 'ok';
		});
		expect(runs).toBe(1);
		expect(summary.startedCount).toBe(1);
		expect(summary.skippedCount).toBe(1);
		expect(summary.lockReleased).toBe(true);
	});

	it('double-click Schedule triggers one request', async () => {
		let runs = 0;
		const summary = await simulateConcurrentPublishClicks(2, async () => {
			runs += 1;
			await new Promise((r) => setTimeout(r, 15));
			return 'scheduled';
		});
		expect(runs).toBe(1);
		expect(summary.startedCount).toBe(1);
		expect(summary.skippedCount).toBe(1);
	});

	it('failed publish unlocks correctly', async () => {
		const lock = createPublishLock();
		const first = await runWithPublishLock(lock, async () => {
			throw new Error('WP failed');
		});
		expect(first.started).toBe(true);
		expect(first.error?.message).toBe('WP failed');
		expect(lock.isLocked()).toBe(false);

		let retried = false;
		const second = await runWithPublishLock(lock, async () => {
			retried = true;
			return 'retry-ok';
		});
		expect(retried).toBe(true);
		expect(second.started).toBe(true);
		expect(second.result).toBe('retry-ok');
		expect(lock.isLocked()).toBe(false);
	});

	it('successful publish unlocks correctly', async () => {
		const lock = createPublishLock();
		const outcome = await runWithPublishLock(lock, async () => 'published');
		expect(outcome).toEqual({ started: true, result: 'published' });
		expect(lock.isLocked()).toBe(false);
	});

	it('retry works normally after unlock', async () => {
		const lock = createPublishLock();
		await runWithPublishLock(lock, async () => {
			throw new Error('boom');
		});
		const retry = await runWithPublishLock(lock, async () => 'ok');
		expect(retry.started).toBe(true);
		expect(retry.result).toBe('ok');
	});

	it('Save Draft remains unaffected (separate saveLockRef path)', () => {
		const src = readFileSync(writerPagePath, 'utf8');
		expect(src).toContain('saveLockRef');
		expect(src).toMatch(/const save = async[\s\S]*saveLockRef\.current/);
		expect(src).toContain('publishLockRef');
		// Save must not share the publish lock.
		const saveBlock = src.slice(src.indexOf('const save = async'), src.indexOf('const publishToWp'));
		expect(saveBlock).toContain('saveLockRef');
		expect(saveBlock).not.toContain('publishLockRef');
	});

	it('WriterPage publishToWp acquires publishLockRef before work', () => {
		const src = readFileSync(writerPagePath, 'utf8');
		expect(src).toContain("from '@/lib/writer-publish-lock'");
		expect(src).toContain('createPublishLock');
		const publishBlock = src.slice(src.indexOf('const publishToWp'), src.indexOf('const openScheduleModal'));
		expect(publishBlock).toContain('publishLockRef.current.tryAcquire');
		expect(publishBlock).toContain('publishLockRef.current.release');
		expect(publishBlock).toMatch(/finally\s*\{[\s\S]*release\(\)/);
	});

	it('Schedule modal keeps its own submit lock (belt-and-suspenders)', () => {
		const src = readFileSync(scheduleModalPath, 'utf8');
		expect(src).toContain('submitLockRef');
		expect(src).toMatch(/if \(submitting \|\| submitLockRef\.current\) return/);
	});
});
