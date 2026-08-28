import fs from 'node:fs';
import path from 'node:path';

/**
 * Ensure dist ships a concise public llms.txt for Seodeva.
 * Prefer copying from public/ (Vite also copies it); fall back to inline content
 * when public/llms.txt is missing so emptyOutDir=false builds never leave a blank file.
 */
const LLMS_CONTENT = `# Seodeva

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

function run() {
	const cwd = process.cwd();
	const publicFile = path.resolve(cwd, 'public/llms.txt');
	const outDir = path.resolve(cwd, '../../dist/apps/web');
	const outFile = path.join(outDir, 'llms.txt');

	try {
		const fromPublic = fs.existsSync(publicFile)
			? fs.readFileSync(publicFile, 'utf8')
			: LLMS_CONTENT;
		const body = String(fromPublic || '').trim() ? fromPublic : LLMS_CONTENT;

		fs.mkdirSync(outDir, { recursive: true });
		fs.writeFileSync(outFile, body.endsWith('\n') ? body : `${body}\n`);
		console.log('[generate-llms] wrote', outFile);
	} catch (error) {
		console.warn('[generate-llms] skipped:', error?.message || error);
	}
}

run();
