#!/usr/bin/env node
/**
 * Cross-platform PocketBase launcher for npm scripts (Windows, Linux, macOS).
 */

import { spawnSync } from 'node:child_process';
import { POCKETBASE_APP_ROOT, resolvePocketBaseBinary } from './resolve-pocketbase-binary.mjs';

const args = process.argv.slice(2);
if (args.length === 0) {
	console.error('Usage: node scripts/run-pocketbase.mjs <pocketbase-args...>');
	process.exit(1);
}

const binary = await resolvePocketBaseBinary();
const result = spawnSync(binary, args, {
	cwd: POCKETBASE_APP_ROOT,
	stdio: 'inherit',
	env: process.env,
});

process.exit(result.status ?? 1);
