import { useMemo, useRef, useState } from 'react';
import {
	Loader2, RefreshCw, Type, Hash, Search, Pencil, AlertCircle,
	BookOpen, Sparkles, Briefcase,
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
	children,
}) {
	return (
		<div className={`wr-sec-card${busy ? ' is-busy' : ''}${editing ? ' is-editing' : ''}`} data-section-id={id}>
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
	const abortRef = useRef({});

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
						onEdit={() => {
							setEditingId(block.id);
							const node = document.querySelector(`[data-section-id="${block.id}"] textarea, [data-section-id="${block.id}"] input`);
							if (node && typeof node.focus === 'function') node.focus();
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
							<div className="space-y-2">
								<Input
									label="Heading"
									value={article.sections?.[block.index]?.heading || ''}
									onChange={(e) => updateSectionField(block.index, 'heading', e.target.value)}
									disabled={busy}
								/>
								<Textarea
									label="Content"
									rows={5}
									value={article.sections?.[block.index]?.content || ''}
									onChange={(e) => updateSectionField(block.index, 'content', e.target.value)}
									disabled={busy}
								/>
							</div>
						) : null}

						{block.kind === 'faq' ? (
							<div className="space-y-2">
								{(article.faq || []).map((item, index) => (
									<div key={item._editorId || index} className="rounded-lg border border-border/80 p-2.5 space-y-2">
										<Input
											label={`Question ${index + 1}`}
											value={item.question || ''}
											onChange={(e) => updateFaqItem(index, 'question', e.target.value)}
											disabled={busy}
										/>
										<Textarea
											label="Answer"
											rows={2}
											value={item.answer || ''}
											onChange={(e) => updateFaqItem(index, 'answer', e.target.value)}
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

