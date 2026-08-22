/**
 * AI-PINS-01 Featured / Always Featured must not queue AI image jobs.
 * Run: node --test src/lib/__tests__/featuredImageMode.contract.test.js
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	IMAGE_SOURCE_STRATEGY,
	pinsNeedingAiImageJobs,
	planImageSource,
	resolveGenerateImageMode,
} from '../imageSourceStrategy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, '../..');

function readSrc(relativePath) {
	return readFileSync(path.join(webSrc, relativePath), 'utf8');
}

describe('AI-PINS-01 Featured image mode', () => {
	it('A. Always Featured plans use_featured and does not request AI', () => {
		const plan = planImageSource({
			strategy: IMAGE_SOURCE_STRATEGY.ALWAYS_FEATURED,
			articleImageUrl: 'https://cdn.example/hero.jpg',
		});
		assert.equal(plan.imageMode, 'use_featured');
		assert.equal(plan.useAi, false);
		assert.equal(plan.requireArticleImage, true);
	});

	it('A. Featured chip resolves to use_featured even if the AI-first plan would queue AI', () => {
		assert.equal(resolveGenerateImageMode({
			qualityImageMode: 'use_featured',
			panelImageMode: 'use_featured',
			planImageMode: 'generate_ai',
		}), 'use_featured');
	});

	it('A. Featured pins are not included in AI image job enqueue', () => {
		const queued = pinsNeedingAiImageJobs([
			{
				tempId: 'featured-1',
				imageMode: 'use_featured',
				imagePlan: { imageMode: 'use_featured', useAi: false },
			},
			{
				tempId: 'featured-always',
				imagePlan: { imageMode: 'use_featured' },
			},
		]);
		assert.deepEqual(queued, []);
	});

	it('B. AI image mode stays generate_ai and still queues AI jobs', () => {
		const plan = planImageSource({
			strategy: IMAGE_SOURCE_STRATEGY.AI_FIRST,
			articleImageUrl: 'https://cdn.example/hero.jpg',
		});
		assert.equal(plan.imageMode, 'generate_ai');
		assert.equal(plan.useAi, true);
		assert.equal(resolveGenerateImageMode({
			qualityImageMode: 'generate_ai',
			panelImageMode: 'generate_ai',
			planImageMode: 'generate_ai',
		}), 'generate_ai');
		const queued = pinsNeedingAiImageJobs([
			{ tempId: 'ai-1', imageMode: 'generate_ai' },
			{ tempId: 'ai-2', imagePlan: { imageMode: 'generate_ai' } },
		]);
		assert.equal(queued.length, 2);
	});

	it('C. featured_first / always_ai keep existing AI generation plans', () => {
		const featuredFirst = planImageSource({
			strategy: IMAGE_SOURCE_STRATEGY.FEATURED_FIRST,
			articleImageUrl: 'https://cdn.example/hero.jpg',
		});
		assert.equal(featuredFirst.imageMode, 'generate_ai');
		assert.equal(featuredFirst.useAi, true);
		const alwaysAi = planImageSource({
			strategy: IMAGE_SOURCE_STRATEGY.ALWAYS_AI,
			articleImageUrl: 'https://cdn.example/hero.jpg',
		});
		assert.equal(alwaysAi.imageMode, 'generate_ai');
		assert.equal(alwaysAi.useAi, true);
	});

	it('studio generate and preview pipeline honor Featured without hardcoding generate_ai', () => {
		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		const pipeline = readSrc('services/ai-pins/previewImagePipeline.js');
		assert.match(studio, /resolveGenerateImageMode\(/);
		assert.match(studio, /imageMode: selectedImageMode/);
		assert.doesNotMatch(studio, /imageMode: 'generate_ai',\n\t\t\t\t\t\timagePlan/);
		assert.match(pipeline, /pinsNeedingAiImageJobs\(pins\)/);
		assert.match(pipeline, /buildDirectFeaturedComposeInputs/);
		assert.match(pipeline, /imageMode: 'generate_ai'/);
	});

	it('A. worker still skips ai_image credits for use_featured jobs', () => {
		const queue = readFileSync(
			path.resolve(webSrc, '../../api/src/services/ai-pin-image-queue.js'),
			'utf8',
		);
		const processFn = queue.slice(
			queue.indexOf('async function processJob(job)'),
			queue.indexOf('function nextRetryDate'),
		);
		assert.match(processFn, /image_mode === 'use_featured'/);
		assert.ok(
			processFn.indexOf("image_mode === 'use_featured'") < processFn.indexOf('withAiImageCredits(job,'),
		);
	});
});
