import fs from 'node:fs';
import path from 'node:path';

function run() {
	const outDir = path.resolve(process.cwd(), '../../dist/apps/web');
	const outFile = path.join(outDir, 'llms.txt');

	try {
		fs.mkdirSync(outDir, { recursive: true });
		if (!fs.existsSync(outFile)) {
			fs.writeFileSync(outFile, '');
		}
		console.log('[generate-llms] completed');
	} catch (error) {
		console.warn('[generate-llms] skipped:', error?.message || error);
	}
}

run();
