import { useMemo, useRef, useState } from 'react';
import {
	Loader2, RefreshCw, Type, Hash, Search, Pencil, AlertCircle,
	BookOpen, Sparkles, Briefcase, GripVertical, ChevronUp, ChevronDown,
	Plus, Trash2, SplitSquareVertical, Merge,
} from 'lucide-react';
import { Button, Input, Textarea, Spinner } from '@/components/kit';
import { generateText, extractJson } from '@/lib/aiGenerate';
import { isFeatureLockedError } from '@/lib/templateAccess';

/** Compact section AI toolbar — same Phase 3.2 flow, more discoverable actions. */
export const SECTION_AI_ACTIONS = [
	{ id: 'rewrite', label: 'Rewrite', shortLabel: 'Rewrite', icon: RefreshCw, tip: 'Rewrite this section clearly while keeping the same meaning' },
	{ id: 'expand', label: 'Expand', shortLabel: 'Expand', icon: Type, tip: 'Add useful detail and examples to this section' },
	{ id: 'shorten', label: 'Shorten', shortLabel: 'Shorten', icon: Hash, tip: 'Make this section shorter while keeping key points' },
	{ id: 'seo', label: 'Improve SEO', shortLabel: 'SEO', icon: Search, tip: 'Improve SEO phrasing for this section only' },
	{ id: 'readability', label: 'Improve Readability', shortLabel: 'Read', icon: BookOpen, tip: 'Improve readability and scannability of this section' },
	{ id: 'simplify', label: 'Simplify', shortLabel: 'Simple', icon: Sparkles, tip: 'Simplify wording in this section' },
	{ id: 'professional', label: 'More Professional Tone', shortLabel: 'Pro', icon: Briefcase, tip: 'Rewrite this section in a more professional tone' },
];

function newEditorId(prefix) {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return `${prefix}_${crypto.randomUUID()}`;
	}
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function createEmptySection(heading = '') {
	return {
		heading: heading || '',
		content: '',
		level: 'h2',
		_editorId: newEditorId('section'),
	};
}

function reorderSections(sections, fromIndex, toIndex) {
	const list = [...(sections || [])];
	if (
		fromIndex < 0
		|| toIndex < 0
		|| fromIndex >= list.length
		|| toIndex >= list.length
		|| fromIndex === toIndex
	) {
		return list;
	}
	const [item] = list.splice(fromIndex, 1);
	list.splice(toIndex, 0, item);
	return list;
}

function mergeSectionContents(first, second) {
	const parts = [];
	if (String(first?.content || '').trim()) parts.push(String(first.content).trim());
	if (String(second?.heading || '').trim()) {
		parts.push(`<p><strong>${String(second.heading).trim()}</strong></p>`);
	}
	if (String(second?.content || '').trim()) parts.push(String(second.content).trim());
	return parts.join('\n');
}

/** Attach stable session editor ids without changing persisted meaning. */
export function assignEditorIds(article) {
	if (!article || typeof article !== 'object') return article;
	return {
		...article,
		_editorId: article._editorId || 'introduction',
		sections: (article.sections || []).map((section) => ({
			...section,
			_editorId: section?._editorId || newEditorId('section'),
		})),
		faq: (article.faq || []).map((item) => ({
			...item,
			_editorId: item?._editorId || newEditorId('faq'),
		})),
		_conclusionEditorId: article._conclusionEditorId || 'conclusion',
		_faqBlockEditorId: article._faqBlockEditorId || 'faq-block',
	};
}

/** Strip editor-only ids before Save Draft / publish persistence. */
export function stripEditorIds(article) {
	if (!article || typeof article !== 'object') return article;
	const {
		_editorId,
		_conclusionEditorId,
		_faqBlockEditorId,
		sections,
		faq,
		...rest
	} = article;
	return {
		...rest,
		sections: (sections || []).map((section) => {
			if (!section || typeof section !== 'object') return section;
			const { _editorId: _sid, ...sectionRest } = section;
			return sectionRest;
		}),
		faq: (faq || []).map((item) => {
			if (!item || typeof item !== 'object') return item;
			const { _editorId: _fid, ...faqRest } = item;
			return faqRest;
		}),
	};
}

function actionInstruction(actionId) {
	switch (actionId) {
		case 'rewrite':
			return 'Rewrite this content clearly and engagingly. Keep the same meaning and approximate length.';
		case 'expand':
			return 'Expand this content with useful detail, examples, and clearer explanations. Keep it on-topic.';
		case 'shorten':
			return 'Shorten this content. Keep the key points. Remove fluff.';
		case 'seo':
			return 'Improve SEO: natural keyword usage, clearer headings/phrasing, scannable structure. Do not keyword-stuff.';
		case 'readability':
			return 'Improve readability: shorter sentences, clearer structure, easier scanning. Keep the same meaning and facts.';
		case 'simplify':
			return 'Simplify the language. Prefer plain words and clear sentences. Keep the same meaning.';
		case 'professional':
			return 'Rewrite in a more professional, polished tone suitable for a published article. Keep the same meaning.';
		default:
			return 'Improve this content while keeping the same intent.';
	}
}

function buildSectionPrompt({
	actionId,
	kind,
	keyword,
	language,
	tone,
	title,
	payload,
}) {
	const instruction = actionInstruction(actionId);
	const context = [
		`Main keyword: ${keyword || '(none)'}`,
		`Language: ${language || 'English'}`,
		`Tone: ${tone || 'Friendly'}`,
		`Article title: ${title || '(untitled)'}`,
		`Section type: ${kind}`,
		`Task: ${instruction}`,
		'Return ONLY valid JSON (no markdown fences).',
	].join('\n');

	if (kind === 'introduction' || kind === 'conclusion') {
		return `${context}\n\nCurrent HTML/text:\n${payload.content || ''}\n\nJSON shape:\n{"content":"<p>...</p>"}`;
	}
	if (kind === 'section') {
		return `${context}\n\nCurrent heading: ${payload.heading || ''}\nCurrent content HTML/text:\n${payload.content || ''}\n\nJSON shape:\n{"heading":"...","content":"<p>...</p>","level":"h2"}`;
	}
	if (kind === 'faq') {
		return `${context}\n\nCurrent FAQ JSON:\n${JSON.stringify(payload.faq || [], null, 2)}\n\nJSON shape:\n{"faq":[{"question":"...","answer":"..."}]}`;
	}
	return context;
}

function normalizeFaqItems(items, previous = []) {
	if (!Array.isArray(items)) return previous;
	return items.map((item, index) => ({
		question: String(item?.question || '').trim(),
		answer: String(item?.answer || '').trim(),
		_editorId: previous[index]?._editorId || newEditorId('faq'),
	})).filter((item) => item.question || item.answer);
}

function SectionAiToolbar({
	sectionTitle,
	busy,
	activeActionId,
	disabled,
	onAction,
}) {
	return (
		<div
			className="wr-sec-toolbar"
			role="toolbar"
			aria-label={`AI tools for ${sectionTitle}`}
			aria-busy={busy ? 'true' : undefined}
		>
			<span className="wr-sec-toolbar__label" aria-hidden="true">AI</span>
			{SECTION_AI_ACTIONS.map((action) => {
				const Icon = action.icon;
				const isActive = busy && activeActionId === action.id;
				const tip = `${action.label}: ${action.tip}`;
				return (
					<button
						key={action.id}
						type="button"
						className={`wr-sec-toolbar__btn${isActive ? ' is-active' : ''}`}
						disabled={busy || disabled}
						onClick={() => onAction(action.id)}
						title={tip}
						aria-label={`${action.label} — ${sectionTitle}`}
						aria-pressed={isActive ? 'true' : undefined}
					>
						{isActive ? (
							<Loader2 size={13} className="animate-spin" aria-hidden="true" />
						) : (
							<Icon size={13} aria-hidden="true" />
						)}
						<span className="wr-sec-toolbar__btn-text">{action.shortLabel}</span>
					</button>
				);
			})}
		</div>
	);
}

function SectionStructureToolbar({
	sectionTitle,
	disabled,
	canMoveUp,
	canMoveDown,
	canMergeNext,
	onMoveUp,
	onMoveDown,
	onAddAbove,
	onAddBelow,
	onSplit,
	onMergeNext,
	onDelete,
	dragHandleProps,
}) {
	return (
		<div
			className="wr-sec-structure"
			role="toolbar"
			aria-label={`Structure tools for ${sectionTitle}`}
		>
			<span className="wr-sec-structure__label" aria-hidden="true">Structure</span>
			<button
				type="button"
				className="wr-sec-structure__btn wr-sec-structure__drag"
				title="Drag to reorder"
				aria-label={`Drag to reorder ${sectionTitle}`}
				disabled={disabled}
				{...dragHandleProps}
			>
				<GripVertical size={14} aria-hidden="true" />
			</button>
			<button type="button" className="wr-sec-structure__btn" title="Move up" aria-label={`Move ${sectionTitle} up`} disabled={disabled || !canMoveUp} onClick={onMoveUp}>
				<ChevronUp size={14} aria-hidden="true" />
			</button>
			<button type="button" className="wr-sec-structure__btn" title="Move down" aria-label={`Move ${sectionTitle} down`} disabled={disabled || !canMoveDown} onClick={onMoveDown}>
				<ChevronDown size={14} aria-hidden="true" />
			</button>
			<button type="button" className="wr-sec-structure__btn" title="Add section above" aria-label={`Add section above ${sectionTitle}`} disabled={disabled} onClick={onAddAbove}>
				<Plus size={14} aria-hidden="true" />
				<span className="wr-sec-structure__btn-text">Above</span>
			</button>
			<button type="button" className="wr-sec-structure__btn" title="Add section below" aria-label={`Add section below ${sectionTitle}`} disabled={disabled} onClick={onAddBelow}>
				<Plus size={14} aria-hidden="true" />
				<span className="wr-sec-structure__btn-text">Below</span>
			</button>
			<button type="button" className="wr-sec-structure__btn" title="Split at cursor in content field" aria-label={`Split ${sectionTitle} at cursor`} disabled={disabled} onClick={onSplit}>
				<SplitSquareVertical size={14} aria-hidden="true" />
				<span className="wr-sec-structure__btn-text">Split</span>
			</button>
			<button type="button" className="wr-sec-structure__btn" title="Merge with next section" aria-label={`Merge ${sectionTitle} with next section`} disabled={disabled || !canMergeNext} onClick={onMergeNext}>
				<Merge size={14} aria-hidden="true" />
				<span className="wr-sec-structure__btn-text">Merge</span>
			</button>
			<button type="button" className="wr-sec-structure__btn is-danger" title="Delete section" aria-label={`Delete ${sectionTitle}`} disabled={disabled} onClick={onDelete}>
				<Trash2 size={14} aria-hidden="true" />
				<span className="wr-sec-structure__btn-text">Delete</span>
			</button>
		</div>
	);
}

function SectionCard({
	id,
	title,
	busy,
	activeActionId,
	error,
	editing,
	onEdit,
	onRetry,
	onAction,
	disabledActions,
	structure,
	insertAction,
	dragOver,
	children,
}) {
	return (
		<div
			className={`wr-sec-card${busy ? ' is-busy' : ''}${editing ? ' is-editing' : ''}${dragOver ? ' is-drag-over' : ''}`}
			data-section-id={id}
		>
			<div className="wr-sec-card__head">
				<div>
					<p className="wr-sec-card__title">{title}</p>
					{busy ? (
						<p className="wr-sec-card__status inline-flex items-center gap-1.5">
							<Spinner className="h-3.5 w-3.5" />
							{activeActionId
								? `${SECTION_AI_ACTIONS.find((a) => a.id === activeActionId)?.label || 'Updating'}…`
								: 'Updating this section…'}
						</p>
					) : null}
				</div>
				<button
					type="button"
					className={`wr-sec-edit-btn${editing ? ' is-active' : ''}`}
					disabled={busy}
					onClick={onEdit}
					title={`Focus editor for ${title}`}
					aria-label={`Edit ${title}`}
				>
					<Pencil size={13} aria-hidden="true" />
					<span>Edit</span>
				</button>
			</div>

			{structure ? (
				<SectionStructureToolbar
					sectionTitle={title}
					disabled={busy || structure.disabled}
					canMoveUp={structure.canMoveUp}
					canMoveDown={structure.canMoveDown}
					canMergeNext={structure.canMergeNext}
					onMoveUp={structure.onMoveUp}
					onMoveDown={structure.onMoveDown}
					onAddAbove={structure.onAddAbove}
					onAddBelow={structure.onAddBelow}
					onSplit={structure.onSplit}
					onMergeNext={structure.onMergeNext}
					onDelete={structure.onDelete}
					dragHandleProps={structure.dragHandleProps}
				/>
			) : null}

			{insertAction ? (
				<div className="wr-sec-structure wr-sec-structure--insert" role="toolbar" aria-label={`Insert section for ${title}`}>
					<button
						type="button"
						className="wr-sec-structure__btn"
						title={insertAction.title}
						aria-label={insertAction.label}
						disabled={busy || insertAction.disabled}
						onClick={insertAction.onClick}
					>
						<Plus size={14} aria-hidden="true" />
						<span className="wr-sec-structure__btn-text">{insertAction.text}</span>
					</button>
				</div>
			) : null}

			<SectionAiToolbar
				sectionTitle={title}
				busy={busy}
				activeActionId={activeActionId}
				disabled={disabledActions}
				onAction={onAction}
			/>

			<div className={`wr-sec-card__body${busy ? ' is-locked' : ''}`}>
				{children}
			</div>

			{error ? (
				<div className="wr-sec-card__error" role="alert">
					<p className="inline-flex items-start gap-1.5">
						<AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
						<span>{error}</span>
					</p>
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={onRetry}
						aria-label={`Retry AI action for ${title}`}
					>
						Retry
					</Button>
				</div>
			) : null}
		</div>
	);
}

/**
 * Per-section editor for Writer — edits update article state only (dirty via Phase 3.1 fingerprint).
 */
export default function WriterSectionBlocks({
	article,
	form,
	onChangeArticle,
	writerPlanAllowed = true,
	onPlanLocked,
}) {
	const [editingId, setEditingId] = useState(null);
	const [busyMap, setBusyMap] = useState({});
	const [activeActionMap, setActiveActionMap] = useState({});
	const [errors, setErrors] = useState({});
	const [lastAction, setLastAction] = useState({});
	const [dragFromIndex, setDragFromIndex] = useState(null);
	const [dragOverIndex, setDragOverIndex] = useState(null);
	const abortRef = useRef({});
	const caretBySectionRef = useRef({});

	const sectionCount = article?.sections?.length || 0;

	const blocks = useMemo(() => {
		if (!article) return [];
		const list = [
			{
				id: article._editorId || 'introduction',
				kind: 'introduction',
				title: 'Introduction',
			},
			...(article.sections || []).map((section, index) => ({
				id: section._editorId || `section-${index}`,
				kind: 'section',
				title: `Section ${index + 1}`,
				index,
			})),
		];
		if ((article.faq || []).length > 0) {
			list.push({
				id: article._faqBlockEditorId || 'faq-block',
				kind: 'faq',
				title: 'FAQ',
			});
		}
		list.push({
			id: article._conclusionEditorId || 'conclusion',
			kind: 'conclusion',
			title: 'Conclusion',
		});
		return list;
	}, [article]);

	if (!article) return null;

	const patchArticle = (updater) => {
		onChangeArticle((prev) => {
			if (!prev) return prev;
			return typeof updater === 'function' ? updater(prev) : updater;
		});
	};

	const focusSectionContent = (sectionId) => {
		requestAnimationFrame(() => {
			const node = document.getElementById(`wr-sec-content-${sectionId}`);
			if (node && typeof node.focus === 'function') node.focus();
		});
	};

	const rememberCaret = (sectionId, event) => {
		const start = event?.target?.selectionStart;
		if (typeof start === 'number') {
			caretBySectionRef.current[sectionId] = start;
		}
	};

	const updateIntroduction = (value) => {
		patchArticle((prev) => ({ ...prev, introduction: value }));
	};

	const updateConclusion = (value) => {
		patchArticle((prev) => ({ ...prev, conclusion: value }));
	};

	const updateSectionField = (index, field, value) => {
		patchArticle((prev) => {
			const sections = [...(prev.sections || [])];
			const current = { ...(sections[index] || {}) };
			current[field] = value;
			sections[index] = current;
			return { ...prev, sections };
		});
	};

	const updateFaqItem = (index, field, value) => {
		patchArticle((prev) => {
			const faq = [...(prev.faq || [])];
			faq[index] = { ...(faq[index] || {}), [field]: value };
			return { ...prev, faq };
		});
	};

	const moveSection = (fromIndex, toIndex) => {
		patchArticle((prev) => ({
			...prev,
			sections: reorderSections(prev.sections, fromIndex, toIndex),
		}));
	};

	const insertSectionAt = (index, heading = '') => {
		const empty = createEmptySection(heading);
		patchArticle((prev) => {
			const sections = [...(prev.sections || [])];
			const at = Math.max(0, Math.min(index, sections.length));
			sections.splice(at, 0, empty);
			return { ...prev, sections };
		});
		setEditingId(empty._editorId);
		focusSectionContent(empty._editorId);
		return empty._editorId;
	};

	const deleteSectionAt = (index) => {
		const section = article.sections?.[index];
		const label = section?.heading || `Section ${index + 1}`;
		if (!window.confirm(`Delete “${label}”? This cannot be undone until you restore from a saved draft.`)) {
			return;
		}
		patchArticle((prev) => {
			const sections = [...(prev.sections || [])];
			sections.splice(index, 1);
			return { ...prev, sections };
		});
	};

	const splitSectionAt = (index) => {
		const section = article.sections?.[index];
		if (!section) return;
		const sectionId = section._editorId || `section-${index}`;
		const el = document.getElementById(`wr-sec-content-${sectionId}`);
		const content = String(section.content || '');
		let pos = typeof el?.selectionStart === 'number'
			? el.selectionStart
			: caretBySectionRef.current[sectionId];
		if (typeof pos !== 'number' || pos < 0 || pos > content.length) {
			pos = Math.floor(content.length / 2);
		}
		const left = content.slice(0, pos);
		const right = content.slice(pos);
		const next = createEmptySection('');
		next.content = right;
		patchArticle((prev) => {
			const sections = [...(prev.sections || [])];
			const current = { ...(sections[index] || {}) };
			sections[index] = { ...current, content: left };
			sections.splice(index + 1, 0, next);
			return { ...prev, sections };
		});
		setEditingId(next._editorId);
		focusSectionContent(next._editorId);
	};

	const mergeWithNext = (index) => {
		const first = article.sections?.[index];
		const second = article.sections?.[index + 1];
		if (!first || !second) return;
		patchArticle((prev) => {
			const sections = [...(prev.sections || [])];
			const a = { ...(sections[index] || {}) };
			const b = sections[index + 1] || {};
			sections[index] = {
				...a,
				content: mergeSectionContents(a, b),
			};
			sections.splice(index + 1, 1);
			return { ...prev, sections };
		});
		const keepId = first._editorId;
		if (keepId) {
			setEditingId(keepId);
			focusSectionContent(keepId);
		}
	};

	const runAiAction = async (block, actionId) => {
		if (!article) return;
		const sectionId = block.id;
		if (busyMap[sectionId]) return;
		if (!writerPlanAllowed) {
			onPlanLocked?.();
			return;
		}

		abortRef.current[sectionId]?.abort?.();
		const controller = new AbortController();
		abortRef.current[sectionId] = controller;

		setBusyMap((prev) => ({ ...prev, [sectionId]: true }));
		setActiveActionMap((prev) => ({ ...prev, [sectionId]: actionId }));
		setErrors((prev) => ({ ...prev, [sectionId]: undefined }));
		setLastAction((prev) => ({ ...prev, [sectionId]: actionId }));
		setEditingId(sectionId);

		let payload;
		if (block.kind === 'introduction') {
			payload = { content: article.introduction || '' };
		} else if (block.kind === 'conclusion') {
			payload = { content: article.conclusion || '' };
		} else if (block.kind === 'section') {
			const section = article.sections?.[block.index] || {};
			payload = {
				heading: section.heading || '',
				content: section.content || '',
				level: section.level || 'h2',
			};
		} else {
			payload = {
				faq: (article.faq || []).map(({ question, answer }) => ({ question, answer })),
			};
		}

		const idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
			? `ai-writer-section:${crypto.randomUUID()}`
			: `ai-writer-section:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

		try {
			const prompt = buildSectionPrompt({
				actionId,
				kind: block.kind,
				keyword: form?.keyword,
				language: form?.language,
				tone: form?.tone,
				title: article.seo_title,
				payload,
			});
			const { text } = await generateText(prompt, {
				singleShot: true,
				signal: controller.signal,
				idempotencyKey,
			});
			if (controller.signal.aborted) return;

			const json = extractJson(text) || {};
			if (block.kind === 'introduction') {
				const content = String(json.content || '').trim();
				if (!content) throw new Error('AI returned an empty introduction.');
				updateIntroduction(content);
			} else if (block.kind === 'conclusion') {
				const content = String(json.content || '').trim();
				if (!content) throw new Error('AI returned an empty conclusion.');
				updateConclusion(content);
			} else if (block.kind === 'section') {
				const heading = String(json.heading || payload.heading || '').trim();
				const content = String(json.content || '').trim();
				if (!content) throw new Error('AI returned an empty section.');
				patchArticle((prev) => {
					const sections = [...(prev.sections || [])];
					const current = { ...(sections[block.index] || {}) };
					sections[block.index] = {
						...current,
						heading: heading || current.heading || `Section ${block.index + 1}`,
						content,
						level: json.level === 'h3' ? 'h3' : (current.level || 'h2'),
						_editorId: current._editorId || sectionId,
					};
					return { ...prev, sections };
				});
			} else {
				const nextFaq = normalizeFaqItems(json.faq, article.faq || []);
				if (!nextFaq.length) throw new Error('AI returned an empty FAQ.');
				patchArticle((prev) => ({ ...prev, faq: nextFaq }));
			}
		} catch (err) {
			if (controller.signal.aborted || err?.name === 'AbortError') return;
			if (isFeatureLockedError(err) || String(err?.errorCode || '').toUpperCase() === 'FEATURE_LOCKED') {
				onPlanLocked?.(err.access || null);
				return;
			}
			setErrors((prev) => ({
				...prev,
				[sectionId]: err?.message || 'Section update failed. Original text was kept.',
			}));
		} finally {
			if (abortRef.current[sectionId] === controller) {
				delete abortRef.current[sectionId];
			}
			setBusyMap((prev) => {
				if (!prev[sectionId]) return prev;
				const next = { ...prev };
				delete next[sectionId];
				return next;
			});
			setActiveActionMap((prev) => {
				if (!prev[sectionId]) return prev;
				const next = { ...prev };
				delete next[sectionId];
				return next;
			});
		}
	};

	return (
		<div className="wr-sec-list space-y-3">
			{blocks.map((block) => {
				const busy = Boolean(busyMap[block.id]);
				const editing = true;
				const error = errors[block.id];
				const retryAction = lastAction[block.id] || 'rewrite';
				const isBodySection = block.kind === 'section';
				const index = block.index;

				const structure = isBodySection ? {
					disabled: false,
					canMoveUp: index > 0,
					canMoveDown: index < sectionCount - 1,
					canMergeNext: index < sectionCount - 1,
					onMoveUp: () => moveSection(index, index - 1),
					onMoveDown: () => moveSection(index, index + 1),
					onAddAbove: () => insertSectionAt(index),
					onAddBelow: () => insertSectionAt(index + 1),
					onSplit: () => splitSectionAt(index),
					onMergeNext: () => mergeWithNext(index),
					onDelete: () => deleteSectionAt(index),
					dragHandleProps: {
						draggable: !busy,
						onDragStart: (event) => {
							setDragFromIndex(index);
							event.dataTransfer.effectAllowed = 'move';
							event.dataTransfer.setData('text/plain', String(index));
						},
						onDragEnd: () => {
							setDragFromIndex(null);
							setDragOverIndex(null);
						},
					},
				} : null;

				const insertAction = block.kind === 'introduction'
					? {
						title: 'Add a new empty section below the introduction',
						label: 'Add section below introduction',
						text: 'Add section below',
						disabled: false,
						onClick: () => insertSectionAt(0),
					}
					: (block.kind === 'conclusion'
						? {
							title: 'Add a new empty section above the conclusion',
							label: 'Add section above conclusion',
							text: 'Add section above',
							disabled: false,
							onClick: () => insertSectionAt(sectionCount),
						}
						: null);

				return (
					<SectionCard
						key={block.id}
						id={block.id}
						title={block.title}
						busy={busy}
						activeActionId={activeActionMap[block.id] || null}
						error={error}
						editing={editingId === block.id || busy}
						disabledActions={!writerPlanAllowed}
						structure={structure}
						insertAction={insertAction}
						dragOver={isBodySection && dragOverIndex === index}
						onEdit={() => {
							setEditingId(block.id);
							focusSectionContent(block.id);
						}}
						onAction={(actionId) => runAiAction(block, actionId)}
						onRetry={() => runAiAction(block, retryAction)}
					>
						{block.kind === 'introduction' ? (
							<Textarea
								label="Introduction"
								rows={4}
								value={article.introduction || ''}
								onChange={(e) => updateIntroduction(e.target.value)}
								disabled={busy}
							/>
						) : null}

						{block.kind === 'conclusion' ? (
							<Textarea
								label="Conclusion"
								rows={4}
								value={article.conclusion || ''}
								onChange={(e) => updateConclusion(e.target.value)}
								disabled={busy}
							/>
						) : null}

						{block.kind === 'section' ? (
							<div
								className="space-y-2"
								onDragOver={(event) => {
									if (dragFromIndex == null) return;
									event.preventDefault();
									event.dataTransfer.dropEffect = 'move';
									if (dragOverIndex !== index) setDragOverIndex(index);
								}}
								onDragLeave={() => {
									if (dragOverIndex === index) setDragOverIndex(null);
								}}
								onDrop={(event) => {
									event.preventDefault();
									const from = Number(event.dataTransfer.getData('text/plain'));
									const fromIndex = Number.isFinite(from) ? from : dragFromIndex;
									setDragFromIndex(null);
									setDragOverIndex(null);
									if (fromIndex == null || fromIndex === index) return;
									moveSection(fromIndex, index);
								}}
							>
								<Input
									label="Heading"
									value={article.sections?.[block.index]?.heading || ''}
									onChange={(e) => updateSectionField(block.index, 'heading', e.target.value)}
									disabled={busy}
								/>
								<Textarea
									id={`wr-sec-content-${block.id}`}
									label="Content"
									rows={5}
									value={article.sections?.[block.index]?.content || ''}
									onChange={(e) => {
										rememberCaret(block.id, e);
										updateSectionField(block.index, 'content', e.target.value);
									}}
									onSelect={(e) => rememberCaret(block.id, e)}
									onClick={(e) => rememberCaret(block.id, e)}
									onKeyUp={(e) => rememberCaret(block.id, e)}
									disabled={busy}
								/>
								<p className="text-[11px] text-muted-foreground">
									Split uses the cursor position in Content. Place the caret, then click Split.
								</p>
							</div>
						) : null}

						{block.kind === 'faq' ? (
							<div className="space-y-2">
								{(article.faq || []).map((item, faqIndex) => (
									<div key={item._editorId || faqIndex} className="rounded-lg border border-border/80 p-2.5 space-y-2">
										<Input
											label={`Question ${faqIndex + 1}`}
											value={item.question || ''}
											onChange={(e) => updateFaqItem(faqIndex, 'question', e.target.value)}
											disabled={busy}
										/>
										<Textarea
											label="Answer"
											rows={2}
											value={item.answer || ''}
											onChange={(e) => updateFaqItem(faqIndex, 'answer', e.target.value)}
											disabled={busy}
										/>
									</div>
								))}
							</div>
						) : null}
					</SectionCard>
				);
			})}
		</div>
	);
}

