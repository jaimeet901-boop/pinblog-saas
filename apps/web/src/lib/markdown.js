/**
 * Lightweight Markdown → safe HTML for legal pages (no markdown external deps).
 * Supports headings, bold/italic, links, lists, paragraphs, and horizontal rules.
 * Final output is DOMPurify-sanitized before any dangerouslySetInnerHTML consumer.
 */
import { sanitizeRichHtml } from './sanitizeHtml.js';

export function renderMarkdownToHtml(markdown) {
	const source = String(markdown || '').replace(/\r\n/g, '\n');
	if (!source.trim()) return '';

	const escapeHtml = (value) => String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

	const inline = (text) => {
		let html = escapeHtml(text);
		html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
		html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
		html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
		return html;
	};

	const lines = source.split('\n');
	const html = [];
	let inList = false;
	let paragraph = [];

	const flushParagraph = () => {
		if (!paragraph.length) return;
		html.push(`<p>${inline(paragraph.join(' '))}</p>`);
		paragraph = [];
	};

	const closeList = () => {
		if (!inList) return;
		html.push('</ul>');
		inList = false;
	};

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		const trimmed = line.trim();

		if (!trimmed) {
			flushParagraph();
			closeList();
			continue;
		}

		if (/^---+$/.test(trimmed)) {
			flushParagraph();
			closeList();
			html.push('<hr />');
			continue;
		}

		const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
		if (heading) {
			flushParagraph();
			closeList();
			const level = heading[1].length;
			html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
			continue;
		}

		const listItem = trimmed.match(/^[-*]\s+(.+)$/);
		if (listItem) {
			flushParagraph();
			if (!inList) {
				html.push('<ul>');
				inList = true;
			}
			html.push(`<li>${inline(listItem[1])}</li>`);
			continue;
		}

		closeList();
		paragraph.push(trimmed);
	}

	flushParagraph();
	closeList();
	return sanitizeRichHtml(html.join('\n'));
}
