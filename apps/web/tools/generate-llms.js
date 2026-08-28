import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ensure dist ships a concise public llms.txt for Seodeva.
 * Prefer copying from public/ (Vite also copies it); fall back to inline content
 * when public/llms.txt is missing so emptyOutDir=false builds never leave a blank file.
 */
export const LLMS_CONTENT = `# Seodeva

> Seodeva is an AI content and multi-channel publishing platform.

Seodeva helps teams write SEO articles, design branded creatives, connect websites and social channels, then schedule and publish from one workspace.

## Product

- AI writing for SEO-ready articles
- Branded creative and pin design
- Multi-channel publishing (websites, WordPress, Pinterest, Facebook)
- Scheduling and workspace analytics

## Site

- Homepage: https://seodeva.com/
- Privacy: https://seodeva.com/privacy
- Terms: https://seodeva.com/terms

## Contact

- contact@seodeva.com
`;

/**
 * Resolve llms.txt body from optional public file or inline source-of-truth.
 * @param {{ publicFilePath?: string, readPublicFile?: (path: string) => string, publicFileExists?: (path: string) => boolean }} [options]
 */
export function resolveLlmsBody({
	publicFilePath = '',
	readPublicFile = (filePath) => fs.readFileSync(filePath, 'utf8'),
	publicFileExists = (filePath) => fs.existsSync(filePath),
} = {}) {
	if (publicFilePath && publicFileExists(publicFilePath)) {
		const fromPublic = readPublicFile(publicFilePath);
		if (String(fromPublic || '').trim()) {
			return fromPublic;
		}
	}
	return LLMS_CONTENT;
}

function run() {
	const cwd = process.cwd();
	const publicFile = path.resolve(cwd, 'public/llms.txt');
	const outDir = path.resolve(cwd, '../../dist/apps/web');
	const outFile = path.join(outDir, 'llms.txt');

	try {
		const body = resolveLlmsBody({ publicFilePath: publicFile });

		fs.mkdirSync(outDir, { recursive: true });
		fs.writeFileSync(outFile, body.endsWith('\n') ? body : `${body}\n`);
		console.log('[generate-llms] wrote', outFile);
	} catch (error) {
		console.warn('[generate-llms] skipped:', error?.message || error);
	}
}

const isMain = process.argv[1]
	&& path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	run();
}
