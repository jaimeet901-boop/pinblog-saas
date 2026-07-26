import assert from 'node:assert/strict';
import test from 'node:test';
import {
	normalizeDestinationUrl,
	resolvePinDestinationUrl,
	validatePinForPinterestPublish,
} from './pin-publish-destination.js';

test('prefers permanent pin source_url over live article lookup', () => {
	assert.equal(
		resolvePinDestinationUrl(
			{ source_url: 'https://pin.example/permanent' },
			{ url: 'https://article.example/live' },
		),
		'https://pin.example/permanent',
	);
});

test('falls back to article url when pin has no source_url', () => {
	assert.equal(
		resolvePinDestinationUrl({}, { url: 'https://article.example/live' }),
		'https://article.example/live',
	);
});

test('rejects missing or invalid destination before publish', () => {
	const missing = validatePinForPinterestPublish({
		id: 'p1',
		title: 'T',
		image_url: 'https://cdn.example/a.png',
	});
	assert.equal(missing.ok, false);
	assert.match(missing.errors[0], /destination URL/i);

	const invalid = validatePinForPinterestPublish({
		id: 'p1',
		title: 'T',
		image_url: 'https://cdn.example/a.png',
		source_url: 'ftp://bad.example',
	});
	assert.equal(invalid.ok, false);
	assert.match(invalid.errors[0], /invalid/i);

	const ok = validatePinForPinterestPublish({
		id: 'p1',
		title: 'T',
		image_url: 'https://cdn.example/a.png',
		source_url: 'https://blog.example/recipe',
	});
	assert.equal(ok.ok, true);
	assert.equal(ok.destinationUrl, normalizeDestinationUrl('https://blog.example/recipe'));
});

test('destination URL is always resolved for Pinterest link field', () => {
	const destination = resolvePinDestinationUrl({
		source_url: 'https://blog.example/post?utm=1',
	});
	assert.match(destination, /^https:\/\//);
	assert.match(destination, /blog\.example\/post/);
});
