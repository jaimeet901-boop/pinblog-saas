#!/usr/bin/env node
/**
 * Cross-platform wrapper for `pocketbase migrate collections` snapshot flow.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { POCKETBASE_APP_ROOT, resolvePocketBaseBinary } from './resolve-pocketbase-binary.mjs';

const snapshotsDir = join(POCKETBASE_APP_ROOT, 'pb_snapshots');
mkdirSync(snapshotsDir, { recursive: true });

const binary = await resolvePocketBaseBinary();
const child = spawn(
	binary,
	[
		'migrate',
		'collections',
		'--encryptionEnv=PB_ENCRYPTION_KEY',
		'--dir=./pb_data',
		'--migrationsDir=./pb_snapshots',
	],
	{
		cwd: POCKETBASE_APP_ROOT,
		stdio: ['pipe', 'inherit', 'inherit'],
		env: process.env,
	},
);

child.stdin.write('y\n');
child.stdin.end();

child.on('close', (code) => {
	process.exit(code ?? 1);
});

child.on('error', (error) => {
	console.error(error);
	process.exit(1);
});
