import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1';

function getSecretMaterial(preferredKeys = []) {
	const secret = preferredKeys.map((key) => process.env[key]).find(Boolean)
		|| process.env.WORDPRESS_SECRETS_KEY
		|| process.env.PB_ENCRYPTION_KEY;

	if (!secret) {
		const error = new Error('Server secret key is not configured');
		error.status = 500;
		throw error;
	}

	return createHash('sha256').update(secret).digest();
}

function getLegacySecretMaterials() {
	const keys = [
		process.env.PINTEREST_SECRETS_KEY,
		process.env.WORDPRESS_SECRETS_KEY,
		process.env.PB_ENCRYPTION_KEY,
	].filter(Boolean);

	const unique = [...new Set(keys)];
	return unique.map((secret) => createHash('sha256').update(secret).digest());
}

export function isEncryptedSecret(value) {
	return typeof value === 'string' && value.startsWith(`${PREFIX}:`);
}

function encryptWithMaterial(plainValue, key) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(plainValue, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return `${PREFIX}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptWithMaterial(value, key) {
	const [, , ivBase64, authTagBase64, encryptedBase64] = value.split(':');
	if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
		const error = new Error('Invalid encrypted secret format');
		error.status = 500;
		throw error;
	}

	const iv = Buffer.from(ivBase64, 'base64');
	const authTag = Buffer.from(authTagBase64, 'base64');
	const encrypted = Buffer.from(encryptedBase64, 'base64');
	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function encryptSecret(plainValue) {
	if (typeof plainValue !== 'string' || !plainValue) {
		return '';
	}
	return encryptWithMaterial(plainValue, getSecretMaterial());
}

export function decryptSecret(value) {
	if (typeof value !== 'string' || !value) {
		return '';
	}

	if (!isEncryptedSecret(value)) {
		return value;
	}

	return decryptWithMaterial(value, getSecretMaterial());
}

/** Prefer dedicated Pinterest key; fall back to shared keys for legacy ciphertext. */
export function encryptPinterestSecret(plainValue) {
	if (typeof plainValue !== 'string' || !plainValue) {
		return '';
	}
	return encryptWithMaterial(plainValue, getSecretMaterial(['PINTEREST_SECRETS_KEY']));
}

export function decryptPinterestSecret(value) {
	if (typeof value !== 'string' || !value) {
		return '';
	}

	if (!isEncryptedSecret(value)) {
		return value;
	}

	const materials = getLegacySecretMaterials();
	let lastError = null;
	for (const material of materials) {
		try {
			return decryptWithMaterial(value, material);
		} catch (error) {
			lastError = error;
		}
	}

	if (lastError) {
		throw lastError;
	}

	const error = new Error('Unable to decrypt Pinterest secret');
	error.status = 500;
	throw error;
}
