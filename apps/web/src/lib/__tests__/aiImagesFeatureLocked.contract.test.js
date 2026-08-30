/**
 * FEATURE_LOCKED UX: UpgradeModal instead of generic red generation toasts.
 * Run: node --test src/lib/__tests__/aiImagesFeatureLocked.contract.test.js
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, '../..');

function readSrc(relativePath) {
	return readFileSync(path.join(webSrc, relativePath), 'utf8');
}

function sliceBetween(source, startMarker, endMarker) {
	const start = source.indexOf(startMarker);
	assert.ok(start >= 0, `missing start marker: ${startMarker}`);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
	return source.slice(start, end);
}

describe('FEATURE_LOCKED UX — Content Studio + Writer', () => {
	it('A. AI Images image pipeline: UpgradeModal before featured fallback', () => {
		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		assert.match(studio, /openFeatureLockedUpgradeModal|openAiImagesUpgradeModal/);
		assert.match(studio, /resolveLockedFeatureIdentity/);
		assert.match(studio, /featureKey:\s*'aiImages'/);
		assert.match(studio, /sourcePage:\s*'ai_pins_images'/);

		const startCatch = sliceBetween(studio, 'const startPreviewImageGeneration', 'const applyTemplateComposeResults');
		assert.ok(startCatch.includes('isFeatureLockedError(error)'));
		const lockIdx = startCatch.indexOf('isFeatureLockedError(error)');
		const lastResortIdx = startCatch.indexOf('runLastResortArticleCompose');
		assert.ok(lockIdx >= 0 && lastResortIdx > lockIdx);

		const regen = sliceBetween(studio, 'const regeneratePreviewImage', 'const downloadImage');
		assert.ok(regen.includes('isFeatureLockedError(error)'));
		assert.doesNotMatch(regen, /featured_fallback/);
		assert.match(regen, /AI image regenerate failed/);
		assert.ok(regen.indexOf('isFeatureLockedError(error)') < regen.indexOf('AI image regenerate failed'));
	});

	it('B. handleGenerate: FEATURE_LOCKED before Generation failed toast', () => {
		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		const handleGenerate = sliceBetween(studio, 'const handleGenerate = async', 'const regeneratePreviewImage');
		assert.ok(handleGenerate.includes('isFeatureLockedError(error)'));
		assert.ok(handleGenerate.includes('openFeatureLockedUpgradeModal(error)'));
		const lockIdx = handleGenerate.indexOf('isFeatureLockedError(error)');
		const failToastIdx = handleGenerate.indexOf("title: 'Generation failed'");
		assert.ok(lockIdx >= 0 && failToastIdx > lockIdx, 'FEATURE_LOCKED must precede Generation failed toast');
		assert.match(studio, /resolveLockedFeatureIdentity/);
		assert.doesNotMatch(
			studio,
			/setUpgradeModal\(\{\s*templateId:\s*'aiWriter',\s*templateName:\s*'AI Writer'/,
		);
	});

	it('C/D. handleAnalyzeArticle + handleGeneratePrompt preserve payload and open modal', () => {
		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		const analyze = sliceBetween(studio, 'const handleAnalyzeArticle', 'const handleGeneratePrompt');
		assert.ok(analyze.includes('createImageJobsApiError'));
		assert.ok(analyze.includes('isFeatureLockedError(error)'));
		assert.ok(analyze.includes('openFeatureLockedUpgradeModal(error)'));
		assert.ok(analyze.indexOf('isFeatureLockedError(error)') < analyze.indexOf("title: 'Analyze failed'"));

		const prompts = sliceBetween(studio, 'const handleGeneratePrompt', 'useEffect(() => {\n\t\tloadAccounts');
		assert.ok(prompts.includes('createImageJobsApiError'));
		assert.ok(prompts.includes('isFeatureLockedError(error)'));
		assert.ok(prompts.includes('openFeatureLockedUpgradeModal(error)'));
		assert.ok(prompts.indexOf('isFeatureLockedError(error)') < prompts.indexOf("title: 'Prompt failed'"));
	});

	it('E. handleRegeneratePin: FEATURE_LOCKED before generic Error toast', () => {
		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		const regenPin = sliceBetween(studio, 'const handleRegeneratePin', 'const updatePinField');
		assert.ok(regenPin.includes('isFeatureLockedError(error)'));
		assert.ok(regenPin.includes('openFeatureLockedUpgradeModal(error)'));
		assert.ok(regenPin.indexOf('isFeatureLockedError(error)') < regenPin.indexOf("title: 'Error'"));
	});

	it('F. WriterPage: FEATURE_LOCKED opens UpgradeModal without destructive toast', () => {
		const writer = readSrc('pages/app/WriterPage.jsx');
		assert.match(writer, /isFeatureLockedError/);
		assert.match(writer, /openWriterUpgrade/);
		const friendly = sliceBetween(writer, 'function friendlyGenerationError', 'const INLINE_TOOLS');
		assert.doesNotMatch(friendly, /status === 403/);
		assert.match(friendly, /FEATURE_LOCKED|isFeatureLockedError/);

		const failPath = sliceBetween(writer, 'const friendly = friendlyGenerationError(err)', 'setGenerating(false)');
		assert.ok(failPath.includes('planLocked'));
		assert.ok(failPath.includes('openWriterUpgrade'));
		assert.ok(failPath.includes('resolveGenerationEditorRestore'));
		const planReturn = failPath.indexOf('openWriterUpgrade');
		const earlyReturn = failPath.indexOf('return;', planReturn);
		const toastIdx = failPath.indexOf("variant: 'destructive'");
		assert.ok(planReturn >= 0 && earlyReturn > planReturn && earlyReturn < toastIdx);
	});

	it('G. WriterSectionBlocks: onPlanLocked only — no inline error on lock', () => {
		const blocks = readSrc('components/writer/WriterSectionBlocks.jsx');
		const catchBlock = sliceBetween(blocks, '} catch (err) {', '} finally {');
		assert.ok(catchBlock.includes('isFeatureLockedError(err)'));
		assert.ok(catchBlock.includes('onPlanLocked'));
		const lockReturn = catchBlock.indexOf('onPlanLocked');
		const setErrors = catchBlock.indexOf('setErrors');
		assert.ok(lockReturn >= 0 && setErrors > lockReturn);
		assert.ok(catchBlock.indexOf('return;', lockReturn) < setErrors);
	});

	it('H/I. FEATURE_LOCKED must not be temporary; generic Generation failed path remains for other errors', () => {
		const classifier = readSrc('lib/textProviderErrors.js');
		const authBranch = classifier.slice(
			classifier.indexOf('// Permanent: credentials / auth'),
			classifier.indexOf('// Permanent: misconfiguration'),
		);
		assert.match(authBranch, /status === 403/);
		assert.match(authBranch, /temporary:\s*false/);

		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		assert.match(studio, /title: 'Generation failed'/);
		assert.match(studio, /AI generation is unavailable right now/);

		const detect = readSrc('lib/templateAccess.js');
		assert.match(detect, /export function isFeatureLockedError/);
		assert.match(detect, /FEATURE_LOCKED/);
	});

	it('use_featured still skips AI job queue (unchanged)', () => {
		const pipeline = readSrc('services/ai-pins/previewImagePipeline.js');
		assert.match(pipeline, /pinsNeedingAiImageJobs/);
		assert.match(pipeline, /createImageJobsApiError/);
		assert.match(pipeline, /error\.errorCode = errorCode/);
		assert.match(pipeline, /error\.access = payload\.access/);
	});
});
