import { useEffect, useId, useRef, useState } from 'react';
import {
	Copy, ImagePlus, Loader2, RefreshCw, Trash2, Upload,
} from 'lucide-react';
import './AssetUploader.css';

const DEFAULT_ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];

function formatBytes(bytes) {
	const n = Number(bytes) || 0;
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDimensions(width, height) {
	if (!width || !height) return '—';
	return `${width} × ${height}`;
}

function formatUpdatedAt(value) {
	if (!value) return '—';
	try {
		return new Date(value).toLocaleString();
	} catch {
		return '—';
	}
}

function readImageDimensions(file) {
	return new Promise((resolve) => {
		if (!file || !String(file.type || '').startsWith('image/')) {
			resolve({ width: null, height: null });
			return;
		}
		const objectUrl = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			resolve({
				width: img.naturalWidth || null,
				height: img.naturalHeight || null,
			});
			URL.revokeObjectURL(objectUrl);
		};
		img.onerror = () => {
			resolve({ width: null, height: null });
			URL.revokeObjectURL(objectUrl);
		};
		img.src = objectUrl;
	});
}

/**
 * Reusable brand/media asset uploader.
 *
 * Generic enough for Platform Identity, Brand Kits, workspace logos, etc.
 * Parent owns persistence via onUpload / onRemove.
 */
export default function AssetUploader({
	label = 'Asset',
	description = '',
	value = null,
	accept = DEFAULT_ACCEPT,
	maxSizeMB = 5,
	disabled = false,
	busy = false,
	restoreDefaultDisabled = true,
	onUpload,
	onRemove,
	onCopyUrl,
	className = '',
}) {
	const inputId = useId();
	const inputRef = useRef(null);
	const [previewFailed, setPreviewFailed] = useState(false);
	const [localError, setLocalError] = useState('');
	const [copyState, setCopyState] = useState('');

	const url = String(value?.url || '').trim();
	const hasAsset = Boolean(url) && !previewFailed;

	useEffect(() => {
		setPreviewFailed(false);
		setLocalError('');
	}, [url]);

	const acceptAttr = Array.isArray(accept) ? accept.join(',') : String(accept || '');

	const validateFile = (file) => {
		if (!file) return 'Choose an image file.';
		const allowed = Array.isArray(accept) ? accept : DEFAULT_ACCEPT;
		if (allowed.length && !allowed.includes(file.type)) {
			return `Unsupported format. Allowed: ${allowed.join(', ')}`;
		}
		const maxBytes = Number(maxSizeMB) * 1024 * 1024;
		if (file.size > maxBytes) {
			return `File is too large (max ${maxSizeMB}MB).`;
		}
		return '';
	};

	const pickFile = () => {
		if (disabled || busy) return;
		inputRef.current?.click();
	};

	const handleFile = async (file) => {
		const error = validateFile(file);
		if (error) {
			setLocalError(error);
			return;
		}
		setLocalError('');
		try {
			const dimensions = await readImageDimensions(file);
			await onUpload?.(file, dimensions);
		} catch (err) {
			setLocalError(err?.message || 'Upload failed.');
		}
	};

	const onInputChange = async (event) => {
		const file = event.target.files?.[0];
		event.target.value = '';
		if (file) await handleFile(file);
	};

	const handleRemove = async () => {
		if (disabled || busy || !url) return;
		setLocalError('');
		try {
			await onRemove?.();
		} catch (err) {
			setLocalError(err?.message || 'Remove failed.');
		}
	};

	const handleCopy = async () => {
		if (!url) return;
		try {
			if (onCopyUrl) {
				await onCopyUrl(url);
			} else if (navigator?.clipboard?.writeText) {
				await navigator.clipboard.writeText(url);
			} else {
				throw new Error('Clipboard unavailable');
			}
			setCopyState('Copied');
			window.setTimeout(() => setCopyState(''), 1600);
		} catch {
			setCopyState('Copy failed');
			window.setTimeout(() => setCopyState(''), 1600);
		}
	};

	return (
		<article className={`asset-uploader${className ? ` ${className}` : ''}${busy ? ' is-busy' : ''}`}>
			<header className="asset-uploader__header">
				<div>
					<h4 className="asset-uploader__title">{label}</h4>
					{description ? <p className="asset-uploader__hint">{description}</p> : null}
				</div>
			</header>

			<div className="asset-uploader__body">
				<div className={`asset-uploader__preview${hasAsset ? '' : ' is-empty'}`}>
					{hasAsset ? (
						<img
							src={url}
							alt=""
							onError={() => setPreviewFailed(true)}
						/>
					) : (
						<div className="asset-uploader__placeholder">
							<ImagePlus size={22} aria-hidden="true" />
							<span>{previewFailed ? 'Preview unavailable' : 'No asset yet'}</span>
						</div>
					)}
					{busy ? (
						<div className="asset-uploader__busy" aria-live="polite">
							<Loader2 size={18} className="animate-spin" />
						</div>
					) : null}
				</div>

				<div className="asset-uploader__meta">
					<div><span>File name</span><strong title={value?.fileName || ''}>{value?.fileName || '—'}</strong></div>
					<div><span>File size</span><strong>{url ? formatBytes(value?.fileSize) : '—'}</strong></div>
					<div><span>Dimensions</span><strong>{url ? formatDimensions(value?.width, value?.height) : '—'}</strong></div>
					<div><span>Last updated</span><strong>{url ? formatUpdatedAt(value?.updatedAt) : '—'}</strong></div>
				</div>
			</div>

			{localError ? <p className="asset-uploader__error">{localError}</p> : null}

			<div className="asset-uploader__actions">
				<input
					id={inputId}
					ref={inputRef}
					type="file"
					accept={acceptAttr}
					hidden
					disabled={disabled || busy}
					onChange={onInputChange}
				/>
				<button
					type="button"
					className="asset-uploader__btn asset-uploader__btn--primary"
					onClick={pickFile}
					disabled={disabled || busy}
				>
					{busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
					{url ? 'Replace' : 'Upload'}
				</button>
				<button
					type="button"
					className="asset-uploader__btn"
					onClick={handleCopy}
					disabled={disabled || busy || !url}
				>
					<Copy size={14} />
					{copyState || 'Copy URL'}
				</button>
				<button
					type="button"
					className="asset-uploader__btn asset-uploader__btn--danger"
					onClick={handleRemove}
					disabled={disabled || busy || !url}
				>
					<Trash2 size={14} />
					Remove
				</button>
				<button
					type="button"
					className="asset-uploader__btn"
					disabled={restoreDefaultDisabled}
					title="Restore Default arrives in a later phase"
				>
					<RefreshCw size={14} />
					Restore Default
				</button>
			</div>
		</article>
	);
}

export { formatBytes, formatDimensions, readImageDimensions };
