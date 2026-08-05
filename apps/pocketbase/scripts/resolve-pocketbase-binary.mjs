#!/usr/bin/env node
/**
 * Resolve (and optionally bootstrap) the local PocketBase binary for dev scripts.
 * Binaries are gitignored; production Docker downloads its own copy independently.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	accessSync,
	chmodSync,
	constants,
	createWriteStream,
	readFileSync,
	unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const POCKETBASE_APP_ROOT = join(__dirname, '..');

const DEFAULT_VERSION = '0.38.0';

function readPinnedVersion() {
	try {
		const raw = readFileSync(join(POCKETBASE_APP_ROOT, '.pocketbase-version'), 'utf8').trim();
		return raw || DEFAULT_VERSION;
	} catch {
		return DEFAULT_VERSION;
	}
}

function releaseTarget() {
	const { platform, arch } = process;
	if (platform === 'win32') {
		if (arch === 'x64' || arch === 'amd64') return { os: 'windows', arch: 'amd64', binaryName: 'pocketbase.exe' };
		throw new Error(`Unsupported PocketBase dev architecture on Windows: ${arch}`);
	}
	if (platform === 'linux') {
		if (arch === 'x64' || arch === 'amd64') return { os: 'linux', arch: 'amd64', binaryName: 'pocketbase' };
		if (arch === 'arm64') return { os: 'linux', arch: 'arm64', binaryName: 'pocketbase' };
		throw new Error(`Unsupported PocketBase dev architecture on Linux: ${arch}`);
	}
	if (platform === 'darwin') {
		if (arch === 'x64' || arch === 'amd64') return { os: 'darwin', arch: 'amd64', binaryName: 'pocketbase' };
		if (arch === 'arm64') return { os: 'darwin', arch: 'arm64', binaryName: 'pocketbase' };
		throw new Error(`Unsupported PocketBase dev architecture on macOS: ${arch}`);
	}
	throw new Error(`Unsupported PocketBase dev platform: ${platform}`);
}

function localBinaryPath(binaryName) {
	return join(POCKETBASE_APP_ROOT, binaryName);
}

function isUsableBinary(binaryPath) {
	try {
		const mode = process.platform === 'win32' ? constants.F_OK : (constants.F_OK | constants.X_OK);
		accessSync(binaryPath, mode);
		const probe = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' });
		return probe.status === 0;
	} catch {
		return false;
	}
}

async function downloadToFile(url, destination) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
	}
	await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function sha256File(filePath) {
	const hash = createHash('sha256');
	hash.update(readFileSync(filePath));
	return hash.digest('hex');
}

function extractZip(zipPath, destinationDir, binaryName) {
	const tar = spawnSync('tar', ['-xf', zipPath, '-C', destinationDir, binaryName], { stdio: 'inherit' });
	if (tar.status === 0) {
		return join(destinationDir, binaryName);
	}

	if (process.platform === 'win32') {
		const ps = [
			'-NoProfile',
			'-Command',
			`Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`,
		];
		const result = spawnSync('powershell.exe', ps, { stdio: 'inherit' });
		if (result.status !== 0) {
			throw new Error('Failed to extract PocketBase archive on Windows');
		}
		return join(destinationDir, binaryName);
	}

	const unzip = spawnSync('unzip', ['-o', zipPath, binaryName, '-d', destinationDir], { stdio: 'inherit' });
	if (unzip.status === 0) {
		return join(destinationDir, binaryName);
	}

	throw new Error('Failed to extract PocketBase archive (tried tar, unzip, and platform fallback)');
}

async function bootstrapPocketBaseBinary() {
	const version = readPinnedVersion();
	const target = releaseTarget();
	const binaryPath = localBinaryPath(target.binaryName);
	const zipName = `pocketbase_${version}_${target.os}_${target.arch}.zip`;
	const zipUrl = `https://github.com/pocketbase/pocketbase/releases/download/v${version}/${zipName}`;
	const checksumsUrl = `https://github.com/pocketbase/pocketbase/releases/download/v${version}/checksums.txt`;
	const zipPath = join(POCKETBASE_APP_ROOT, zipName);

	console.log(`Downloading PocketBase v${version} for ${target.os}/${target.arch}...`);
	await downloadToFile(zipUrl, zipPath);

	const checksumResponse = await fetch(checksumsUrl);
	if (!checksumResponse.ok) {
		throw new Error(`Failed to download checksums: HTTP ${checksumResponse.status}`);
	}
	const checksums = await checksumResponse.text();
	const expectedLine = checksums.split('\n').find((line) => line.trim().endsWith(` ${zipName}`));
	const expectedSha = expectedLine?.split(/\s+/)[0]?.trim();
	if (!expectedSha) {
		throw new Error(`Checksum entry not found for ${zipName}`);
	}
	const actualSha = await sha256File(zipPath);
	if (actualSha !== expectedSha) {
		throw new Error(`Checksum mismatch for ${zipName}\nExpected: ${expectedSha}\nActual:   ${actualSha}`);
	}

	const extractedPath = extractZip(zipPath, POCKETBASE_APP_ROOT, target.binaryName);
	try {
		unlinkSync(zipPath);
	} catch {
		/* best effort cleanup */
	}

	if (extractedPath !== binaryPath) {
		throw new Error(`Expected PocketBase binary at ${binaryPath}, got ${extractedPath}`);
	}

	if (process.platform !== 'win32') {
		chmodSync(binaryPath, 0o755);
	}

	if (!isUsableBinary(binaryPath)) {
		throw new Error(`PocketBase binary is not runnable after bootstrap: ${binaryPath}`);
	}

	console.log(`PocketBase ready at ${binaryPath}`);
	return binaryPath;
}

/**
 * @param {{ bootstrap?: boolean }} [options]
 * @returns {Promise<string>}
 */
export async function resolvePocketBaseBinary(options = {}) {
	const { bootstrap = true } = options;
	const target = releaseTarget();
	const binaryPath = localBinaryPath(target.binaryName);

	if (isUsableBinary(binaryPath)) {
		return binaryPath;
	}

	if (!bootstrap) {
		throw new Error(
			`PocketBase binary not found or not runnable at ${binaryPath}. `
			+ 'Download the matching release from https://github.com/pocketbase/pocketbase/releases '
			+ `or run npm run dev --prefix apps/pocketbase to bootstrap v${readPinnedVersion()}.`,
		);
	}

	return bootstrapPocketBaseBinary();
}
