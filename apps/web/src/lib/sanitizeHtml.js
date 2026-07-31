/**
 * Sanitize untrusted HTML before dangerouslySetInnerHTML (High Priority #2).
 * Uses DOMPurify (isomorphic) — blocks scripts, event handlers, javascript: URLs.
 */
import DOMPurify from 'isomorphic-dompurify';

/** Tags needed for Writer recipe/article previews and legal markdown HTML. */
const ALLOWED_TAGS = [
	'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
	'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li',
	'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'span',
	'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
	'thead', 'tr', 'u', 'ul', 'var',
];

const ALLOWED_ATTR = [
	'href', 'title', 'target', 'rel', 'class', 'id',
	'src', 'alt', 'width', 'height', 'loading',
	'colspan', 'rowspan', 'scope', 'headers',
	'start', 'type', 'cite',
];

/**
 * Sanitize HTML for safe React rendering.
 * @param {unknown} dirty
 * @returns {string}
 */
export function sanitizeRichHtml(dirty) {
	if (dirty == null) return '';
	const input = String(dirty);
	if (!input) return '';

	return DOMPurify.sanitize(input, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		ALLOW_DATA_ATTR: false,
		ALLOW_UNKNOWN_PROTOCOLS: false,
		SAFE_FOR_TEMPLATES: true,
		// Keep existing Writer preview behavior: no executable / JSON-LD scripts in DOM preview.
		FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'style'],
		FORBID_ATTR: [
			'style',
			'srcdoc',
			'xlink:href',
		],
	});
}

/**
 * True when sanitization removed or neutralized XSS-relevant payloads.
 * Used by regression tests (not a security boundary by itself).
 */
export function containsBlockedHtmlPayload(html) {
	const raw = String(html || '');
	if (/<script\b/i.test(raw)) return true;
	if (/\son[a-z]+\s*=/i.test(raw)) return true;
	if (/javascript\s*:/i.test(raw)) return true;
	if (/<iframe\b/i.test(raw)) return true;
	return false;
}
