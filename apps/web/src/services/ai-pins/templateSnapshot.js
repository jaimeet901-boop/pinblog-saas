/**
 * Historical template snapshot helpers for AI Pin drafts.
 * Snapshot is the source of truth after save — never auto-replaced by live gallery.
 */

/**
 * Format: revision@checksum  e.g. 1.4.2@7c2f9ab
 * Left side prefers editorVersion.schemaVersion.revision when available.
 */
export function formatTemplateVersionSnapshot({
	revision,
	editorVersion,
	schemaVersion,
	configChecksum,
	config_checksum,
} = {}) {
	const parts = [editorVersion, schemaVersion, revision]
		.map((value) => {
			if (value == null || value === '') return null;
			return String(value).trim();
		})
		.filter(Boolean);
	const left = parts.length > 0 ? parts.join('.') : '0';
	const checksum = String(configChecksum || config_checksum || 'unknown').trim() || 'unknown';
	return `${left}@${checksum.slice(0, 64)}`;
}

export function buildTemplateSnapshotFields(pin = {}, templateMeta = null) {
	const configuration = pin.templateConfig
		|| pin.templateConfiguration
		|| pin.template_configuration
		|| null;
	const id = String(pin.templateId || pin.template_id || templateMeta?.id || '').trim();
	const name = String(
		pin.templateName
		|| pin.template_name
		|| templateMeta?.name
		|| '',
	).trim();
	const version = String(
		pin.templateVersion
		|| pin.template_version
		|| (templateMeta
			? formatTemplateVersionSnapshot(templateMeta)
			: ''),
	).trim();
	const thumbnail = String(
		pin.templateThumbnail
		|| pin.template_thumbnail
		|| templateMeta?.thumbnail
		|| templateMeta?.thumbnailUrl
		|| templateMeta?.previewUrl
		|| '',
	).trim();
	const snapshotAt = pin.templateSnapshotAt
		|| pin.template_snapshot_at
		|| (configuration || id ? new Date().toISOString() : '');

	if (!id && !configuration && !name) {
		return null;
	}

	return {
		templateId: id,
		templateName: name || 'Pin Layout',
		templateVersion: version || formatTemplateVersionSnapshot(templateMeta || {}),
		templateConfiguration: configuration && typeof configuration === 'object' ? configuration : null,
		templateThumbnail: thumbnail,
		templateSnapshotAt: snapshotAt,
	};
}

/**
 * Map PB / API snake_case or camelCase into pin template snapshot fields.
 * Missing fields stay empty — pre-migration drafts load normally.
 */
export function mapTemplateSnapshotFromRecord(record = {}) {
	const configuration = record.template_configuration
		?? record.templateConfiguration
		?? record.templateConfig
		?? null;
	return {
		templateId: String(record.template_id || record.templateId || '').trim(),
		templateName: String(record.template_name || record.templateName || '').trim(),
		templateVersion: String(record.template_version || record.templateVersion || '').trim(),
		templateConfig: configuration && typeof configuration === 'object' ? configuration : null,
		templateConfiguration: configuration && typeof configuration === 'object' ? configuration : null,
		templateThumbnail: String(record.template_thumbnail || record.templateThumbnail || '').trim(),
		templateSnapshotAt: record.template_snapshot_at || record.templateSnapshotAt || '',
	};
}

export function hasTemplateSnapshot(pin = {}) {
	return Boolean(
		pin.templateConfig
		|| pin.templateConfiguration
		|| pin.template_configuration
		|| pin.templateId
		|| pin.template_id,
	);
}

/**
 * Payload fragment for PocketBase create. Only includes keys with values.
 */
export function toTemplateSnapshotPayload(pin = {}) {
	const snapshot = buildTemplateSnapshotFields(pin);
	if (!snapshot) return {};

	const payload = {};
	if (snapshot.templateId) payload.template_id = snapshot.templateId.slice(0, 80);
	if (snapshot.templateName) payload.template_name = snapshot.templateName.slice(0, 180);
	if (snapshot.templateVersion) payload.template_version = snapshot.templateVersion.slice(0, 120);
	if (snapshot.templateConfiguration) {
		payload.template_configuration = snapshot.templateConfiguration;
	}
	if (snapshot.templateThumbnail) {
		payload.template_thumbnail = snapshot.templateThumbnail.slice(0, 4000);
	}
	if (snapshot.templateSnapshotAt) {
		payload.template_snapshot_at = snapshot.templateSnapshotAt;
	}
	return payload;
}

/**
 * Build editor PATCH body fragment.
 * Omitted keys must not be sent so the API leaves existing values unchanged.
 * Pass clearTemplate: true only for explicit user removal.
 */
export function toTemplateEditorPatch(pin = {}, { clearTemplate = false } = {}) {
	if (clearTemplate) {
		return {
			templateId: '',
			templateName: '',
			templateVersion: '',
			templateConfiguration: null,
			templateThumbnail: '',
			templateSnapshotAt: '',
			clearTemplate: true,
		};
	}
	if (!hasTemplateSnapshot(pin)) {
		return {};
	}
	const snapshot = buildTemplateSnapshotFields(pin);
	if (!snapshot) return {};
	return {
		templateId: snapshot.templateId,
		templateName: snapshot.templateName,
		templateVersion: snapshot.templateVersion,
		templateConfiguration: snapshot.templateConfiguration,
		templateThumbnail: snapshot.templateThumbnail,
		templateSnapshotAt: snapshot.templateSnapshotAt,
	};
}

/**
 * Export package for a draft — includes historical template snapshot.
 * Used by JSON export / download metadata paths.
 */
export function buildPinExportPackage(pin = {}) {
	const snapshot = mapTemplateSnapshotFromRecord(pin);
	return {
		id: pin.id || pin.tempId || '',
		title: pin.title || '',
		description: pin.description || '',
		overlayText: pin.overlayText || pin.overlay_text || '',
		imageUrl: pin.imageUrl || pin.image_url || '',
		template: {
			id: snapshot.templateId,
			name: snapshot.templateName,
			version: snapshot.templateVersion,
			thumbnail: snapshot.templateThumbnail,
			snapshotAt: snapshot.templateSnapshotAt,
			configuration: snapshot.templateConfig,
		},
	};
}

export const ORIGINAL_TEMPLATE_UNAVAILABLE = 'Original template unavailable';
