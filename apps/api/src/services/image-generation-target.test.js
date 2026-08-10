import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	FACEBOOK_POST_GENERATION_TARGET,
	FACEBOOK_STORY_GENERATION_TARGET,
	PINTEREST_GENERATION_TARGET,
	resolveImageGenerationTarget,
	resolveImageGenerationTargetFromPayload,
} from './image-generation-target.js';

describe('resolveImageGenerationTarget', () => {
	it('defaults to Pinterest when no channel is provided', () => {
		const target = resolveImageGenerationTarget({});
		assert.equal(target.channel, 'pinterest');
		assert.equal(target.aspectRatio, '2:3');
		assert.equal(target.openaiSize, '1024x1536');
	});

	it('resolves Facebook link post from export profile', () => {
		const target = resolveImageGenerationTarget({
			channel: 'facebook',
			exportProfileId: 'facebook_post',
		});
		assert.equal(target.exportProfileId, 'facebook_post');
		assert.equal(target.orientation, 'landscape');
		assert.equal(target.openaiSize, '1536x1024');
		assert.deepEqual(target.falImageSize, { width: 1200, height: 630 });
		assert.equal(target.geminiAspectRatio, '16:9');
	});

	it('resolves Facebook story from export profile', () => {
		const target = resolveImageGenerationTarget({
			channel: 'facebook',
			exportProfileId: 'facebook_story',
		});
		assert.equal(target.exportProfileId, 'facebook_story');
		assert.equal(target.aspectRatio, '9:16');
		assert.deepEqual(target.falImageSize, { width: 1080, height: 1920 });
		assert.equal(target.geminiAspectRatio, '9:16');
	});

	it('keeps Pinterest when channel is pinterest even with empty profile', () => {
		const target = resolveImageGenerationTarget({
			channel: 'pinterest',
			exportProfileId: '',
		});
		assert.equal(target, PINTEREST_GENERATION_TARGET);
	});

	it('rehydrates from prompt_payload snapshot', () => {
		const target = resolveImageGenerationTargetFromPayload(
			{ exportProfileId: 'facebook_story', channel: 'facebook' },
		);
		assert.equal(target, FACEBOOK_STORY_GENERATION_TARGET);
	});

	it('falls back when snapshot is missing', () => {
		const target = resolveImageGenerationTargetFromPayload(null, {
			channel: 'facebook',
			exportProfileId: 'facebook_post',
		});
		assert.equal(target, FACEBOOK_POST_GENERATION_TARGET);
	});
});
