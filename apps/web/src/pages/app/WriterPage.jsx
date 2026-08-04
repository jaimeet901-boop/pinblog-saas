import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
	PenLine, Wand2, Save, Loader2, Globe, Upload, ExternalLink, ChevronDown,
	FileText, Settings2, ListChecks, Send, Copy, Download, RefreshCw,
	Sparkles, Search, BookOpen, LayoutList, AlertCircle, Hash, Clock,
	Facebook, Image as ImageIcon, Coins, History, Languages, Type,
	Trash2, GripVertical, CheckCircle2, MessageSquareText, Replace,
} from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { generateText, extractJson } from '@/lib/aiGenerate';
import { uploadImageBlob } from '@/services/ai-pins/imageLifecycle';
import { useWorkspaceWebsites } from '@/hooks/useWorkspaceWebsites';
import { withWebsiteQuery } from '@/lib/websites/activeWebsite';
import { usePersistWebsiteQuery } from '@/hooks/usePersistWebsiteQuery';
import { Badge, Button, Input, Select, Textarea, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';
import UpgradeModal from '@/components/billing/UpgradeModal';
import WriterScheduleModal from '@/components/writer/WriterScheduleModal';
import WriterSectionBlocks, {
	assignEditorIds,
	stripEditorIds,
} from '@/components/writer/WriterSectionBlocks';
import { isFeatureLockedError } from '@/lib/templateAccess';
import { isPlanFeatureEnabled } from '@/lib/planFeatures';
import {
	buildArticlePersistPayload,
	resolveArticlePersistRequest,
	resolvePersistedArticleId,
} from '@/lib/writer-article-persist';
import {
	captureGenerationSnapshot,
	isArticleContentDirty,
	resolveGenerationEditorRestore,
	shouldClearDirtyAfterPublish,
	shouldWarnOnLeave,
} from '@/lib/writer-leave-protection';
import { sanitizeRichHtml } from '@/lib/sanitizeHtml';
import { createPublishLock } from '@/lib/writer-publish-lock';
import './WriterPage.css';
const initForm = {
	keyword: '',
	secondary: '',
	country: 'United States',
	language: 'English',
	length: 'Medium (1000-1500 words)',
	tone: 'Friendly',
	headings: '4',
	readingLevel: 'General',
	seoLevel: 'Balanced',
	creativity: 55,
	wpCategory: '',
	tags: '',
	customPrompt: '',
};

const initOptions = {
	toc: true,
	faq: true,
	recipe: true,
	nutrition: false,
	internalLinks: true,
	externalLinks: true,
	conclusion: true,
};

const SECTIONS = [
	{ id: 'basics', label: 'Article Basics', icon: FileText },
	{ id: 'content', label: 'Content Settings', icon: Settings2 },
	{ id: 'options', label: 'Content Options', icon: ListChecks },
	{ id: 'images', label: 'Images', icon: ImageIcon },
	{ id: 'prompt', label: 'AI Prompt', icon: MessageSquareText },
	{ id: 'publishing', label: 'Publishing', icon: Send },
];

const STREAM_PHASES = [
	{ id: 'preparing', label: 'Preparing...' },
	{ id: 'connecting', label: 'Connecting AI...' },
	{ id: 'outline', label: 'Generating outline...' },
	{ id: 'writing', label: 'Writing article...' },
	{ id: 'finalizing', label: 'Finalizing...' },
	{ id: 'completed', label: 'Completed' },
	{ id: 'cancelling', label: 'Cancelling...' },
	{ id: 'cancelled', label: 'Cancelled' },
	{ id: 'failed', label: 'Failed' },
];

const STREAM_PHASE_ORDER = STREAM_PHASES.map((step) => step.id);

function isCancelledGenerationError(err) {
	const code = String(err?.errorCode || '').toUpperCase();
	if (code === 'GENERATION_CANCELLED') return true;
	if (err?.name === 'AbortError') return true;
	return /generation cancelled|aborted|canceled/i.test(String(err?.message || ''));
}

function friendlyGenerationError(err) {
	const code = String(err?.errorCode || '').toUpperCase();
	const status = Number(err?.status) || 0;
	const raw = String(err?.message || '').trim();

	if (code === 'FEATURE_LOCKED' || status === 403) {
		return {
			title: 'Upgrade required',
			description: raw || 'AI Writer is not included in your current plan.',
			kind: 'plan',
		};
	}
	if (code === 'INSUFFICIENT_CREDITS' || status === 402) {
		return {
			title: 'Insufficient credits',
			description: raw || 'Add credits or upgrade your plan to generate articles.',
			kind: 'credits',
		};
	}
	if (code === 'STREAM_ERROR') {
		return {
			title: 'Generation interrupted',
			description: raw || 'The AI stream returned an error. You can retry with the same settings.',
			kind: 'stream',
		};
	}
	if (/parse|json/i.test(raw)) {
		return {
			title: 'Could not finish the article',
			description: 'The AI response was incomplete or invalid. Your settings were kept — try again.',
			kind: 'parse',
		};
	}
	if (/failed to fetch|network|load failed/i.test(raw)) {
		return {
			title: 'Connection problem',
			description: 'We could not stay connected to the AI service. Your inputs were kept — retry when ready.',
			kind: 'network',
		};
	}
	return {
		title: 'Generation failed',
		description: raw || 'Something went wrong while writing. Your inputs were kept — you can retry.',
		kind: 'generic',
	};
}

const INLINE_TOOLS = [
	{ id: 'rewrite', label: 'Rewrite', icon: RefreshCw },
	{ id: 'expand', label: 'Expand', icon: Type },
	{ id: 'shorten', label: 'Shorten', icon: Hash },
	{ id: 'seo', label: 'Improve SEO', icon: Search },
	{ id: 'humanize', label: 'Humanize', icon: Sparkles },
	{ id: 'translate', label: 'Translate', icon: Languages },
];

function stripHtml(value) {
	if (typeof value !== 'string') return '';
	return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function composeHtml(a) {
	const parts = [];
	if (a.introduction) parts.push(a.introduction);
	for (const s of a.sections || []) {
		const level = s.level === 'h3' ? 'h3' : 'h2';
		parts.push(`<${level}>${s.heading || ''}</${level}>`);
		parts.push(s.content || '');
	}
	if (a.faq?.length) {
		parts.push('<h2>Frequently Asked Questions</h2>');
		for (const f of a.faq) {
			parts.push(`<h3>${f.question || ''}</h3>`);
			parts.push(`<p>${f.answer || ''}</p>`);
		}
	}
	if (a.conclusion) {
		parts.push('<h2>Conclusion</h2>');
		parts.push(a.conclusion);
	}
	if (a.recipe_schema) {
		parts.push(
			`<script type="application/ld+json">${JSON.stringify(a.recipe_schema)}</script>`,
		);
	}
	return parts.join('\n');
}

function articlePlainText(a) {
	if (!a) return '';
	const chunks = [
		a.seo_title,
		a.meta_description,
		a.introduction,
		...(a.sections || []).flatMap((s) => [s.heading, stripHtml(s.content)]),
		...(a.faq || []).flatMap((f) => [f.question, f.answer]),
		a.conclusion,
	];
	return chunks.filter(Boolean).join(' ');
}

function countWords(text) {
	const cleaned = stripHtml(text || '').trim();
	if (!cleaned) return 0;
	return cleaned.split(/\s+/).filter(Boolean).length;
}

function creativityGuidance(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 'balanced creativity';
	if (n <= 25) return 'conservative, practical, and literal';
	if (n <= 50) return 'moderately creative with clear practical tips';
	if (n <= 75) return 'creative storytelling with vivid sensory details';
	return 'highly imaginative, distinctive voice, and unexpected but useful angles';
}

function seoLevelGuidance(level) {
	const key = String(level || '').trim().toLowerCase();
	if (key === 'light') {
		return 'Light SEO: natural keyword use, avoid stuffing, keep language conversational.';
	}
	if (key === 'aggressive') {
		return 'Aggressive SEO: denser keyword use in title/meta/headings/intro, strong search intent coverage, without breaking readability.';
	}
	return 'Balanced SEO: clear keyword placement in title, meta, slug, intro, and headings while staying readable.';
}

function normalizeGallery(value) {
	if (!Array.isArray(value)) return [];
	return value.map((url) => String(url || '').trim()).filter(Boolean).slice(0, 40);
}

function buildPersistableBody(article, form) {
	if (!article || typeof article !== 'object') return null;
	const clean = stripEditorIds(article);
	return {
		...clean,
		featured_image: String(clean.featured_image || '').trim(),
		gallery_images: normalizeGallery(clean.gallery_images),
		custom_prompt: String(form?.customPrompt || clean.custom_prompt || '').trim(),
		published_url: String(clean.published_url || '').trim(),
		published_at: String(clean.published_at || '').trim(),
	};
}

/** Fingerprint of fields persisted by Save Draft — used for dirty tracking. */
function buildSaveFingerprint(article, form) {
	if (!article) return null;
	return JSON.stringify({
		article,
		keyword: form?.keyword || '',
		language: form?.language || '',
		country: form?.country || '',
		tone: form?.tone || '',
		customPrompt: form?.customPrompt || '',
	});
}

function formatPublishedAt(value) {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toLocaleString();
}

function scoreArticle(article, form) {
	if (!article) {
		return {
			seo: 0,
			keyword: 0,
			readability: 0,
			missing: ['Article not generated yet'],
			outline: [],
			pinTitles: [],
			pinDescriptions: [],
			fbPreview: '',
			imagePrompt: '',
		};
	}

	const text = articlePlainText(article).toLowerCase();
	const keyword = (form.keyword || '').trim().toLowerCase();
	const secondary = (form.secondary || '')
		.split(',')
		.map((k) => k.trim().toLowerCase())
		.filter(Boolean);
	const words = countWords(text);
	const keywordHits = keyword ? (text.match(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length : 0;
	const density = words ? (keywordHits / words) * 100 : 0;

	let seo = 42;
	if (article.seo_title) seo += 12;
	if ((article.seo_title || '').length >= 40 && (article.seo_title || '').length <= 65) seo += 8;
	if (article.meta_description) seo += 10;
	if ((article.meta_description || '').length >= 120 && (article.meta_description || '').length <= 160) seo += 6;
	if (article.slug) seo += 4;
	if ((article.sections || []).length >= 3) seo += 8;
	if ((article.faq || []).length > 0) seo += 5;
	if (article.conclusion) seo += 4;
	if (article.recipe_schema) seo += 5;
	if (keyword && text.includes(keyword)) seo += 8;
	seo = Math.min(98, Math.round(seo));

	let keywordScore = 20;
	if (keywordHits > 0) keywordScore += 35;
	if (density >= 0.5 && density <= 2.5) keywordScore += 30;
	else if (keywordHits > 0) keywordScore += 15;
	keywordScore += Math.min(15, secondary.filter((k) => text.includes(k)).length * 5);
	keywordScore = Math.min(100, keywordScore);

	const avgSentence = (() => {
		const sentences = stripHtml(text).split(/[.!?]+/).filter((s) => s.trim().length > 0);
		if (!sentences.length) return 18;
		return words / sentences.length;
	})();
	let readability = 78;
	if (avgSentence > 24) readability -= 18;
	else if (avgSentence > 20) readability -= 8;
	if (words > 2200) readability -= 6;
	if ((article.sections || []).length >= 4) readability += 6;
	readability = Math.max(35, Math.min(96, Math.round(readability)));

	const missing = [];
	if (!article.introduction) missing.push('Introduction');
	if (!(article.sections || []).length) missing.push('Body sections');
	if (!(article.faq || []).length) missing.push('FAQ');
	if (!article.conclusion) missing.push('Conclusion');
	if (!article.meta_description) missing.push('Meta description');
	if (!article.recipe_schema) missing.push('Recipe schema');

	const outline = [
		article.seo_title || form.keyword || 'Untitled',
		...(article.sections || []).map((s) => `${(s.level || 'h2').toUpperCase()} · ${s.heading || 'Section'}`),
		(article.faq || []).length ? `FAQ (${article.faq.length})` : null,
		article.conclusion ? 'Conclusion' : null,
	].filter(Boolean);

	const titleBase = article.seo_title || form.keyword || 'Recipe idea';
	const pinTitles = [
		`${titleBase} — easy weeknight win`,
		`Save this: ${titleBase}`,
		`${form.keyword || titleBase} you’ll actually make`,
	];
	const pinDescriptions = [
		`${article.meta_description || `Try this ${form.keyword || 'recipe'} tonight.`} Pin it for later.`,
		`Fresh ${form.tone.toLowerCase()} guide to ${form.keyword || 'this dish'}. Tap to read the full article.`,
	];

	return {
		seo,
		keyword: keywordScore,
		readability,
		missing: missing.length ? missing : ['Looking complete'],
		outline,
		pinTitles,
		pinDescriptions,
		fbPreview: `${titleBase}\n\n${article.meta_description || `A ${form.tone.toLowerCase()} take on ${form.keyword || 'this recipe'}.`}`,
		imagePrompt: `Editorial food photo of ${form.keyword || titleBase}, warm natural light, shallow depth of field, styled on ceramic plate, magazine quality`,
	};
}

function Section({ id, open, onToggle, children }) {
	const meta = SECTIONS.find((item) => item.id === id);
	const Icon = meta?.icon || Settings2;
	return (
		<div className="wr-section">
			<button type="button" className="wr-section__head" onClick={() => onToggle(id)} aria-expanded={open}>
				<span className="inline-flex items-center gap-2">
					<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Icon size={14} />
					</span>
					{meta?.label || id}
				</span>
				<ChevronDown size={16} className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
			</button>
			{open ? <div className="wr-section__body">{children}</div> : null}
		</div>
	);
}

function OptionToggle({ label, checked, onChange }) {
	return (
		<label className="wr-switch">
			<span>{label}</span>
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
		</label>
	);
}

export default function WriterPage() {
	const { toast } = useToast();
	const { platformName } = usePlatformIdentity();
	const [searchParams] = useSearchParams();
	const preferredWebsiteId = String(searchParams.get('websiteId') || '').trim();
	usePersistWebsiteQuery(preferredWebsiteId);
	const [form, setForm] = useState(initForm);
	const [options, setOptions] = useState(initOptions);
	const [generating, setGenerating] = useState(false);
	const [stream, setStream] = useState('');
	const [article, setArticle] = useState(null);
	const [articleBaseline, setArticleBaseline] = useState(null);
	const [savedArticleId, setSavedArticleId] = useState(null);
	const [savedFingerprint, setSavedFingerprint] = useState(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState(null);
	const [publishing, setPublishing] = useState(false);
	const {
		websites: sites,
		websiteId: siteId,
		setWebsiteId: setSiteId,
	} = useWorkspaceWebsites({ preferredId: preferredWebsiteId });
	const activeSite = sites.find((s) => s.id === siteId);
	const pinsHref = withWebsiteQuery('/app/ai-pins', siteId || preferredWebsiteId);
	const articlesHref = siteId
		? `/app/websites/${encodeURIComponent(siteId)}/articles`
		: '/app/websites';
	const [recentDrafts, setRecentDrafts] = useState([]);
	const [history, setHistory] = useState([]);
	const [genPhase, setGenPhase] = useState('idle');
	const [generationError, setGenerationError] = useState(null);
	const [openSections, setOpenSections] = useState({
		basics: true,
		content: true,
		options: true,
		images: true,
		prompt: true,
		publishing: true,
	});
	const [imageBusy, setImageBusy] = useState(false);
	const [dragGalleryIndex, setDragGalleryIndex] = useState(null);
	const [writerPlanAllowed, setWriterPlanAllowed] = useState(true);
	const [upgradeOpen, setUpgradeOpen] = useState(false);
	const [upgradeAccess, setUpgradeAccess] = useState(null);
	const [writerCreditCost, setWriterCreditCost] = useState(null);
	const [scheduleOpen, setScheduleOpen] = useState(false);

	const streamRef = useRef(null);
	const editorRef = useRef(null);
	const featuredInputRef = useRef(null);
	const galleryInputRef = useRef(null);
	const replaceGalleryInputRef = useRef(null);
	const replaceGalleryIndexRef = useRef(-1);
	const generatingLockRef = useRef(false);
	const saveLockRef = useRef(false);
	const publishLockRef = useRef(createPublishLock());
	const abortControllerRef = useRef(null);
	const cancelRequestedRef = useRef(false);
	const isDirtyRef = useRef(false);
	const generationSnapshotRef = useRef(null);
	const preservedMediaRef = useRef({
		featured_image: '',
		gallery_images: [],
		published_url: '',
		published_at: '',
	});

	const loadRecentDrafts = async () => {
		try {
			const response = await apiServerClient.fetch('/content/articles?perPage=6', { method: 'GET' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				setRecentDrafts([]);
				return;
			}
			setRecentDrafts(Array.isArray(payload.items) ? payload.items : []);
		} catch {
			setRecentDrafts([]);
		}
	};

	useEffect(() => {
		loadRecentDrafts();
	}, []);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const response = await apiServerClient.fetch('/workspace/v1/subscription', { method: 'GET' });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok || cancelled) return;
				const features = payload?.plan?.features || payload?.subscription?.features || {};
				const allowed = isPlanFeatureEnabled(features, 'aiWriter');
				// If plan payload omits features, keep UI usable and rely on API enforcement.
				const hasFeatureMap = features && typeof features === 'object' && Object.keys(features).length > 0;
				setWriterPlanAllowed(hasFeatureMap ? allowed : true);
				const fromSubscription = Number(payload?.credits?.featureCosts?.ai_writer);
				if (Number.isFinite(fromSubscription) && fromSubscription >= 0) {
					setWriterCreditCost(fromSubscription);
				}
			} catch {
				if (!cancelled) setWriterPlanAllowed(true);
			}
			try {
				const creditsRes = await apiServerClient.fetch('/workspace/v1/credits', { method: 'GET' });
				const creditsPayload = await creditsRes.json().catch(() => ({}));
				if (!creditsRes.ok || cancelled) return;
				const cost = Number(creditsPayload?.featureCosts?.ai_writer);
				if (Number.isFinite(cost) && cost >= 0) {
					setWriterCreditCost(cost);
				}
			} catch {
				/* keep prior cost */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!generating || !streamRef.current) return;
		streamRef.current.scrollTop = streamRef.current.scrollHeight;
	}, [stream, generating]);

	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
	const setOption = (k) => (value) => setOptions((prev) => ({ ...prev, [k]: value }));
	const toggleSection = (id) => setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
	const upd = (k, v) => setArticle((a) => ({ ...a, [k]: v }));

	const isDirty = useMemo(() => {
		const currentFingerprint = article ? buildSaveFingerprint(article, form) : null;
		const articleDirty = isArticleContentDirty({
			article,
			currentFingerprint,
			savedFingerprint,
		});
		return shouldWarnOnLeave({
			articleDirty,
			generating,
			genPhase,
			stream,
		});
	}, [article, form, savedFingerprint, generating, genPhase, stream]);

	useEffect(() => {
		isDirtyRef.current = isDirty;
	}, [isDirty]);

	// Warn on tab close / refresh while Writer has unsaved work or generation in flight.
	useEffect(() => {
		if (!isDirty) return undefined;
		const onBeforeUnload = (event) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	}, [isDirty]);

	// Warn on in-app navigation away from Writer (sidebar / header links).
	useEffect(() => {
		if (!isDirty) return undefined;
		const onDocumentClick = (event) => {
			if (event.defaultPrevented) return;
			if (event.button !== 0) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const anchor = event.target?.closest?.('a[href]');
			if (!anchor) return;
			if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
			const href = anchor.getAttribute('href');
			if (!href || href.startsWith('#')) return;
			let url;
			try {
				url = new URL(href, window.location.origin);
			} catch {
				return;
			}
			if (url.origin !== window.location.origin) return;
			if (url.pathname === window.location.pathname) return;
			const leave = window.confirm(
				generating
					? 'AI generation is in progress. Leave and lose this run?'
					: 'You have unsaved changes. Leave without saving?',
			);
			if (!leave) {
				event.preventDefault();
				event.stopPropagation();
			}
		};
		document.addEventListener('click', onDocumentClick, true);
		return () => document.removeEventListener('click', onDocumentClick, true);
	}, [isDirty, generating]);

	const stats = useMemo(() => {
		const text = article ? articlePlainText(article) : stream;
		const words = countWords(text);
		const chars = stripHtml(text).length;
		const minutes = Math.max(1, Math.round(words / 200)) || 0;
		return { words, chars, minutes: words ? minutes : 0 };
	}, [article, stream]);

	const insights = useMemo(() => scoreArticle(article, form), [article, form]);
	const creditEstimate = writerCreditCost;

	const buildPrompt = () => {
		const include = Object.entries(options)
			.filter(([, on]) => on)
			.map(([key]) => ({
				toc: 'table of contents',
				faq: 'FAQ section',
				recipe: 'recipe card + recipe schema',
				nutrition: 'nutrition details',
				internalLinks: 'internal link suggestions',
				externalLinks: 'external authoritative links',
				conclusion: 'conclusion',
			}[key]))
			.filter(Boolean);

		const creativity = creativityGuidance(form.creativity);
		const seo = seoLevelGuidance(form.seoLevel);

		return `Write a complete SEO-optimized food blog article.
Main keyword: ${form.keyword}
Secondary keywords: ${form.secondary || 'none'}
Country: ${form.country}
Language: ${form.language}
Article length: ${form.length}
Tone: ${form.tone}
Number of H2/H3 headings: ${form.headings}
Reading level: ${form.readingLevel} — write so a ${String(form.readingLevel || 'General').toLowerCase()} audience can follow easily.
SEO level: ${form.seoLevel}. ${seo}
Creativity: ${form.creativity}/100 — keep the writing ${creativity}.
${include.length ? `Include: ${include.join(', ')}.` : ''}
Respond ONLY with the JSON object described in your instructions.`;
	};

	const openWriterUpgrade = (access = null) => {
		setUpgradeAccess(access || {
			visible: true,
			enabled: false,
			locked: true,
			missingKeys: ['aiWriter'],
			dependencyChain: ['aiWriter'],
		});
		setUpgradeOpen(true);
	};

	const cancelGeneration = () => {
		if (!generating && !generatingLockRef.current) return;
		if (genPhase === 'cancelling' || genPhase === 'cancelled') return;
		cancelRequestedRef.current = true;
		setGenPhase('cancelling');
		try {
			abortControllerRef.current?.abort();
		} catch {
			/* ignore */
		}
	};

	const generate = async (event) => {
		event?.preventDefault?.();
		if (generatingLockRef.current || generating) return;
		if (!writerPlanAllowed) {
			openWriterUpgrade();
			toast({
				variant: 'destructive',
				title: 'Upgrade required',
				description: 'AI Writer is not included in your current plan.',
			});
			return;
		}
		if (!form.keyword.trim()) {
			toast({ variant: 'destructive', title: 'Main keyword required', description: 'Add a keyword to start writing.' });
			return;
		}

		generatingLockRef.current = true;
		cancelRequestedRef.current = false;
		const controller = new AbortController();
		abortControllerRef.current = controller;
		setGenerating(true);
		setGenerationError(null);
		setSaveError(null);
		setGenPhase('preparing');
		setStream('');
		generationSnapshotRef.current = captureGenerationSnapshot({
			article,
			articleBaseline,
			savedFingerprint,
		});
		const preserved = {
			featured_image: article?.featured_image || preservedMediaRef.current.featured_image || '',
			gallery_images: normalizeGallery(article?.gallery_images?.length
				? article.gallery_images
				: preservedMediaRef.current.gallery_images),
			published_url: article?.published_url || preservedMediaRef.current.published_url || '',
			published_at: article?.published_at || preservedMediaRef.current.published_at || '',
		};
		preservedMediaRef.current = preserved;
		// Clear article for streaming UX — leave protection stays active via `generating`.
		setArticle(null);
		setArticleBaseline(null);

		const idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
			? `ai-writer:${crypto.randomUUID()}`
			: `ai-writer:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

		try {
			setGenPhase('connecting');
			const { text } = await generateText(buildPrompt(), {
				signal: controller.signal,
				onChunk: (next) => {
					if (cancelRequestedRef.current || controller.signal.aborted) return;
					setStream(next);
				},
				onStatus: (phase) => {
					if (cancelRequestedRef.current || controller.signal.aborted) return;
					if (phase === 'connecting' || phase === 'outline' || phase === 'writing' || phase === 'finalizing') {
						setGenPhase(phase);
					}
				},
				customPrompt: form.customPrompt,
				singleShot: true,
				idempotencyKey,
			});
			if (cancelRequestedRef.current || controller.signal.aborted) {
				throw Object.assign(new Error('Generation cancelled'), { errorCode: 'GENERATION_CANCELLED' });
			}
			setGenPhase('finalizing');
			const json = extractJson(text);
			if (!json) throw new Error('Could not parse the AI response. Try again.');
			const next = assignEditorIds({
				...json,
				sections: json.sections || [],
				faq: json.faq || [],
				...preserved,
				custom_prompt: form.customPrompt || '',
			});
			generationSnapshotRef.current = null;
			setArticle(next);
			setArticleBaseline(next);
			setSavedFingerprint(null);
			setSaveError(null);
			setGenPhase('completed');
			setHistory((prev) => [
				{
					id: `${Date.now()}`,
					keyword: form.keyword,
					title: next.seo_title || form.keyword,
					at: new Date().toISOString(),
					snapshot: next,
					formSnapshot: { ...form },
				},
				...prev,
			].slice(0, 8));
			requestAnimationFrame(() => editorRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' }));
		} catch (err) {
			if (isCancelledGenerationError(err) || cancelRequestedRef.current) {
				setGenPhase('cancelled');
				setGenerationError(null);
				if (typeof err?.partialText === 'string' && err.partialText) {
					setStream(err.partialText);
				}
				const restore = resolveGenerationEditorRestore({
					outcome: 'cancelled',
					snapshot: generationSnapshotRef.current,
				});
				if (restore.restore) {
					setArticle(restore.snapshot.article);
					setArticleBaseline(restore.snapshot.articleBaseline ?? restore.snapshot.article);
					setSavedFingerprint(restore.snapshot.savedFingerprint ?? null);
				}
				generationSnapshotRef.current = null;
				toast({
					title: 'Cancelled',
					description: 'Generation stopped. Your previous editor content and any streamed text were kept.',
				});
			} else {
				const friendly = friendlyGenerationError(err);
				setGenPhase('failed');
				setGenerationError(friendly);
				const restore = resolveGenerationEditorRestore({
					outcome: 'failed',
					snapshot: generationSnapshotRef.current,
				});
				if (restore.restore) {
					setArticle(restore.snapshot.article);
					setArticleBaseline(restore.snapshot.articleBaseline ?? restore.snapshot.article);
					setSavedFingerprint(restore.snapshot.savedFingerprint ?? null);
				}
				generationSnapshotRef.current = null;
				if (friendly.kind === 'plan' || isFeatureLockedError(err) || String(err?.errorCode || '').toUpperCase() === 'FEATURE_LOCKED') {
					openWriterUpgrade(err.access || null);
				}
				toast({
					variant: 'destructive',
					title: friendly.title,
					description: friendly.description,
				});
			}
		} finally {
			setGenerating(false);
			generatingLockRef.current = false;
			abortControllerRef.current = null;
			cancelRequestedRef.current = false;
		}
	};

	const save = async (status = 'draft') => {
		if (!article) return;
		if (saving || saveLockRef.current) return;

		saveLockRef.current = true;
		setSaving(true);
		setSaveError(null);

		const active = typeof document !== 'undefined' ? document.activeElement : null;
		const selection = active && typeof active.selectionStart === 'number'
			? { start: active.selectionStart, end: active.selectionEnd }
			: null;

		try {
			const persistBody = buildPersistableBody(article, form);
			const payload = buildArticlePersistPayload({
				form,
				article,
				persistBody,
				status,
				scheduledAt: status === 'scheduled' ? new Date(Date.now() + 86400000).toISOString() : '',
			});
			const persist = resolveArticlePersistRequest(savedArticleId);

			const response = await apiServerClient.fetch(persist.path, {
				method: persist.method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(data?.message || `Failed to save article (${response.status})`);
			}

			const nextId = resolvePersistedArticleId(savedArticleId, data);
			if (nextId && nextId !== savedArticleId) {
				setSavedArticleId(nextId);
			}

			// Keep editor state; mark clean.
			setArticleBaseline(article);
			setSavedFingerprint(buildSaveFingerprint(article, form));
			toast({
				title: 'Saved',
				description: status === 'draft'
					? 'Draft saved. You can keep editing.'
					: `Article saved as ${status}. You can keep editing.`,
			});
			await loadRecentDrafts();

			requestAnimationFrame(() => {
				if (!active || typeof active.focus !== 'function') return;
				try {
					active.focus();
					if (selection && typeof active.setSelectionRange === 'function') {
						active.setSelectionRange(selection.start, selection.end);
					}
				} catch {
					/* ignore focus restore failures */
				}
			});
		} catch (err) {
			const message = err?.message || 'Save failed. Please try again.';
			setSaveError(message);
			toast({ variant: 'destructive', title: 'Save failed', description: message });
		} finally {
			setSaving(false);
			saveLockRef.current = false;
		}
	};

	const publishToWp = async (wpStatus, extras = {}) => {
		if (!article) {
			if (extras.throwOnError) throw new Error('Generate an article before scheduling.');
			return;
		}
		const site = sites.find((s) => s.id === siteId);
		if (!site) {
			const err = new Error('Add and connect a WordPress site first.');
			if (!extras.silent) {
				toast({ variant: 'destructive', title: 'No website selected', description: err.message });
			}
			if (extras.throwOnError) throw err;
			return;
		}
		if (publishing || !publishLockRef.current.tryAcquire()) {
			if (extras.throwOnError) {
				throw new Error('A publish or schedule request is already in progress.');
			}
			return;
		}
		setPublishing(true);
		try {
			const persistBody = buildPersistableBody(article, form);
			const articleStatus = extras.scheduledAt ? 'scheduled' : (wpStatus === 'publish' ? 'published' : 'draft');
			const payload = buildArticlePersistPayload({
				form,
				article,
				persistBody,
				status: articleStatus,
				scheduledAt: extras.scheduledAt || '',
			});
			const persist = resolveArticlePersistRequest(savedArticleId);
			const persistResponse = await apiServerClient.fetch(persist.path, {
				method: persist.method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const savedArticle = await persistResponse.json().catch(() => ({}));
			if (!persistResponse.ok) {
				throw new Error(savedArticle?.message || `Failed to save article (${persistResponse.status})`);
			}

			const articleRecordId = resolvePersistedArticleId(savedArticleId, savedArticle);
			if (articleRecordId && articleRecordId !== savedArticleId) {
				setSavedArticleId(articleRecordId);
			}

			const endpoint = extras.scheduledAt ? '/wordpress/schedule' : '/wordpress/publish';
			const res = await apiServerClient.fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					siteId: site.id,
					websiteId: site.id,
					articleId: articleRecordId,
					title: article.seo_title || form.keyword,
					content: composeHtml(article),
					slug: article.slug,
					excerpt: article.meta_description,
					metaDescription: article.meta_description,
					status: extras.scheduledAt ? 'future' : wpStatus,
					scheduledAt: extras.scheduledAt || undefined,
					categories: form.wpCategory ? [form.wpCategory] : [],
					tags: form.tags,
					featuredImageUrl: article.featured_image || article.image_url || '',
					seo: {
						title: article.seo_title,
						metaDescription: article.meta_description,
					},
					recipeCard: options.recipe ? (article.recipe || article.recipe_card || { enabled: true }) : null,
					enqueuePinterest: true,
					idempotencyKey: `writer-${site.id}-${articleRecordId}-${wpStatus}-${extras.scheduledAt || 'now'}`,
				}),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || data.ok === false) {
				throw new Error(data.message || data.error || 'Publish failed');
			}

			const publishedUrl = String(data.link || data.url || '').trim();
			const publishedAt = new Date().toISOString();

			if (data.queued && !publishedUrl) {
			toast({
					title: 'Publish queued',
					description: 'WordPress job is processing in the background. Check history shortly.',
				});
			} else {
				toast({
					title: extras.scheduledAt
						? 'Scheduled on WordPress'
						: (wpStatus === 'publish' ? 'Published to WordPress' : 'Draft sent to WordPress'),
					description: publishedUrl || (data.id ? `Post #${data.id} created.` : 'Job accepted.'),
				});
			}

			if (publishedUrl && wpStatus === 'publish' && !extras.scheduledAt) {
				const nextArticle = {
					...article,
					published_url: publishedUrl,
					published_at: publishedAt,
					custom_prompt: form.customPrompt || '',
				};
				setArticle(nextArticle);
				setArticleBaseline(nextArticle);
				if (articleRecordId) {
					await apiServerClient.fetch(`/content/articles/${articleRecordId}`, {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							published_url: publishedUrl,
							published_at: publishedAt,
							featured_image: article.featured_image || '',
							gallery_images: normalizeGallery(article.gallery_images),
							custom_prompt: form.customPrompt || '',
						}),
					}).catch(() => null);
				}
				if (shouldClearDirtyAfterPublish({ persistSucceeded: true })) {
					setSavedFingerprint(buildSaveFingerprint(nextArticle, form));
				}
			} else {
				setArticleBaseline(article);
				if (shouldClearDirtyAfterPublish({ persistSucceeded: true })) {
					setSavedFingerprint(buildSaveFingerprint(article, form));
				}
			}
			await loadRecentDrafts();
		} catch (err) {
			if (!extras.silent) {
			toast({ variant: 'destructive', title: 'WordPress error', description: err?.message });
			}
			if (extras.throwOnError) throw err;
		} finally {
			setPublishing(false);
			publishLockRef.current.release();
		}
	};

	const openScheduleModal = () => {
		if (!article) return;
		setScheduleOpen(true);
	};

	const handleScheduleSubmit = async ({ scheduledAt }) => {
		await publishToWp('future', {
			scheduledAt,
			throwOnError: true,
			silent: true,
		});
		setScheduleOpen(false);
	};

	const copyArticle = async () => {
		if (!article) return;
		try {
			await navigator.clipboard.writeText(composeHtml(article));
			toast({ title: 'Copied', description: 'HTML article copied to clipboard.' });
		} catch {
			toast({ variant: 'destructive', title: 'Copy failed', description: 'Clipboard access was blocked.' });
		}
	};

	const exportArticle = () => {
		if (!article) return;
		const blob = new Blob([composeHtml(article)], { type: 'text/html;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `${article.slug || form.keyword || 'article'}.html`;
		anchor.click();
		URL.revokeObjectURL(url);
		toast({ title: 'Exported', description: 'HTML file downloaded.' });
	};

	const notifyInlineTool = (label) => {
		toast({
			title: `${label} (preview)`,
			description: 'Inline AI tools are UI-only for now — generation still uses the studio Generate flow.',
		});
	};

	const restoreHistory = (item) => {
		if (isDirtyRef.current && !window.confirm('You have unsaved changes. Discard them and restore this version?')) {
			return;
		}
		const next = assignEditorIds(item.snapshot);
		setArticle(next);
		setArticleBaseline(next);
		setSavedFingerprint(null);
		if (item.formSnapshot) setForm((prev) => ({ ...prev, ...item.formSnapshot }));
		toast({ title: 'Restored', description: item.title });
	};

	const openDraft = (draft) => {
		if (isDirtyRef.current && !window.confirm('You have unsaved changes. Discard them and load this draft?')) {
			return;
		}
		const body = draft.body && typeof draft.body === 'object' ? draft.body : null;
		if (!body) {
			toast({ variant: 'destructive', title: 'Draft unavailable', description: 'This draft has no editable body.' });
			return;
		}
		const next = assignEditorIds({
			...body,
			sections: body.sections || [],
			faq: body.faq || [],
			featured_image: body.featured_image || '',
			gallery_images: normalizeGallery(body.gallery_images),
			published_url: body.published_url || '',
			published_at: body.published_at || '',
			custom_prompt: body.custom_prompt || '',
		});
		const nextForm = {
			...form,
			keyword: draft.keyword || form.keyword,
			language: draft.language || form.language,
			country: draft.country || form.country,
			tone: draft.tone || form.tone,
			customPrompt: body.custom_prompt || form.customPrompt || '',
		};
		setArticle(next);
		setArticleBaseline(next);
		setForm(nextForm);
		setSavedArticleId(draft.id || null);
		setSavedFingerprint(buildSaveFingerprint(next, nextForm));
		setSaveError(null);
		toast({ title: 'Draft loaded', description: draft.seo_title || draft.keyword });
	};

	const ensureArticleShell = () => {
		if (article) return article;
		const shell = assignEditorIds({
			seo_title: form.keyword || 'Untitled article',
			meta_description: '',
			slug: '',
			introduction: '',
			sections: [],
			faq: [],
			conclusion: '',
			featured_image: '',
			gallery_images: [],
			published_url: '',
			published_at: '',
			custom_prompt: form.customPrompt || '',
		});
		setArticle(shell);
		setArticleBaseline(shell);
		return shell;
	};

	const uploadFeaturedImage = async (file) => {
		if (!file) return;
		setImageBusy(true);
		try {
			ensureArticleShell();
			const uploaded = await uploadImageBlob(file, {
				title: form.keyword || article?.seo_title || 'featured-image',
				fileName: file.name || `featured-${Date.now()}.png`,
			});
			setArticle((prev) => ({
				...(prev || {}),
				featured_image: uploaded.imageUrl,
			}));
			toast({ title: 'Featured image uploaded' });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Image upload failed', description: err?.message });
		} finally {
			setImageBusy(false);
			if (featuredInputRef.current) featuredInputRef.current.value = '';
		}
	};

	const removeFeaturedImage = () => {
		setArticle((prev) => (prev ? { ...prev, featured_image: '' } : prev));
	};

	const uploadGalleryImages = async (fileList) => {
		const files = Array.from(fileList || []).filter(Boolean);
		if (!files.length) return;
		setImageBusy(true);
		try {
			ensureArticleShell();
			const uploadedUrls = [];
			for (const file of files) {
				const uploaded = await uploadImageBlob(file, {
					title: form.keyword || article?.seo_title || 'gallery-image',
					fileName: file.name || `gallery-${Date.now()}.png`,
				});
				uploadedUrls.push(uploaded.imageUrl);
			}
			setArticle((prev) => ({
				...(prev || {}),
				gallery_images: normalizeGallery([...(prev?.gallery_images || []), ...uploadedUrls]),
			}));
			toast({ title: 'Images uploaded', description: `${uploadedUrls.length} image(s) added.` });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Gallery upload failed', description: err?.message });
		} finally {
			setImageBusy(false);
			if (galleryInputRef.current) galleryInputRef.current.value = '';
		}
	};

	const replaceGalleryImage = async (file) => {
		const index = replaceGalleryIndexRef.current;
		if (!file || index < 0) return;
		setImageBusy(true);
		try {
			const uploaded = await uploadImageBlob(file, {
				title: form.keyword || article?.seo_title || 'gallery-image',
				fileName: file.name || `gallery-${Date.now()}.png`,
			});
			setArticle((prev) => {
				const gallery = normalizeGallery(prev?.gallery_images);
				if (!gallery[index]) return prev;
				gallery[index] = uploaded.imageUrl;
				return { ...prev, gallery_images: gallery };
			});
			toast({ title: 'Image replaced' });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Replace failed', description: err?.message });
		} finally {
			setImageBusy(false);
			replaceGalleryIndexRef.current = -1;
			if (replaceGalleryInputRef.current) replaceGalleryInputRef.current.value = '';
		}
	};

	const removeGalleryImage = (index) => {
		setArticle((prev) => {
			if (!prev) return prev;
			const gallery = normalizeGallery(prev.gallery_images).filter((_, i) => i !== index);
			return { ...prev, gallery_images: gallery };
		});
	};

	const onGalleryDragStart = (index) => setDragGalleryIndex(index);
	const onGalleryDrop = (index) => {
		if (dragGalleryIndex == null || dragGalleryIndex === index) {
			setDragGalleryIndex(null);
			return;
		}
		setArticle((prev) => {
			if (!prev) return prev;
			const gallery = normalizeGallery(prev.gallery_images);
			const [moved] = gallery.splice(dragGalleryIndex, 1);
			gallery.splice(index, 0, moved);
			return { ...prev, gallery_images: gallery };
		});
		setDragGalleryIndex(null);
	};

	const copyText = async (value, label) => {
		const text = String(value || '').trim();
		if (!text) {
			toast({ variant: 'destructive', title: `Nothing to copy`, description: `${label} is empty.` });
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			toast({ title: 'Copied', description: `${label} copied to clipboard.` });
		} catch {
			toast({ variant: 'destructive', title: 'Copy failed', description: 'Clipboard access was blocked.' });
		}
	};

	useEffect(() => {
		const onKeyDown = (event) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				if (article && !saving) save('draft');
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [article, saving, form, savedArticleId]);

	const renderedHtml = useMemo(() => {
		if (!article) return '';
		return sanitizeRichHtml(composeHtml(article));
	}, [article]);

	return (
		<div className="wr-atelier">
			<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
					<p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{platformName} Studio</p>
					<h1 className="font-display text-3xl font-semibold tracking-tight">AI Writer</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						{activeSite
							? `Writing for ${activeSite.name || activeSite.domain || 'this website'} — craft SEO articles, then create AI Pins.`
							: 'Craft publish-ready SEO recipe articles — then create AI Pins and publish to WordPress.'}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Link to={articlesHref}><Button variant="outline" size="sm">Articles</Button></Link>
					<Link to={pinsHref}><Button size="sm">Next: AI Pins</Button></Link>
				</div>
			</div>

			<div className="wr-atelier__actions">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm font-medium">{form.keyword.trim() || 'New article'}</span>
					{article ? (
						isDirty ? (
							<span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
								Unsaved changes
							</span>
						) : (
							<span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground">Saved</span>
						)
					) : (
						<span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground">Ready to write</span>
					)}
					<span className="hidden text-[11px] text-muted-foreground sm:inline">Ctrl+S</span>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button size="sm" onClick={generate} disabled={generating || !writerPlanAllowed}>
						{generating ? <Spinner className="h-4 w-4" /> : <Wand2 size={14} />}
						Generate
					</Button>
					{generating ? (
						<Button
							size="sm"
							variant="outline"
							type="button"
							onClick={cancelGeneration}
							disabled={genPhase === 'cancelling'}
						>
							{genPhase === 'cancelling' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
							{genPhase === 'cancelling' ? 'Cancelling...' : 'Cancel'}
						</Button>
					) : null}
					<Button size="sm" variant="outline" onClick={generate} disabled={generating || !form.keyword.trim() || !writerPlanAllowed}>
						<RefreshCw size={14} /> Regenerate
					</Button>
					<Button size="sm" variant="outline" onClick={() => save('draft')} disabled={!article || saving}>
						{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save size={14} />}
						{saving ? 'Saving...' : 'Save Draft'}
					</Button>
					<Button size="sm" variant="accent" onClick={() => publishToWp('publish')} disabled={!article || publishing}>
						{publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink size={14} />}
						Publish
					</Button>
					<Button size="sm" variant="ghost" onClick={copyArticle} disabled={!article}>
						<Copy size={14} /> Copy
					</Button>
					<Button size="sm" variant="ghost" onClick={exportArticle} disabled={!article}>
						<Download size={14} /> Export
					</Button>
				</div>
			</div>

			{saveError ? (
				<div className="mb-3 rounded-xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm">
					<p className="font-medium text-destructive">Couldn’t save draft</p>
					<p className="mt-1 text-muted-foreground">{saveError}</p>
					<div className="mt-2">
						<Button size="sm" type="button" variant="outline" disabled={saving || !article} onClick={() => save('draft')}>
							{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save size={14} />}
							{saving ? 'Saving...' : 'Retry save'}
						</Button>
					</div>
				</div>
			) : null}

			{!writerPlanAllowed ? (
				<div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
					<p className="font-medium">AI Writer is not included in your current plan.</p>
					<p className="mt-1 text-muted-foreground">Upgrade to generate SEO articles with Chef IA.</p>
					<div className="mt-2">
						<Button size="sm" type="button" onClick={() => openWriterUpgrade()}>
							View upgrade options
						</Button>
					</div>
				</div>
			) : null}

			{article?.published_url ? (
				<div className="wr-publish-success">
					<div className="wr-publish-success__head">
						<CheckCircle2 size={16} className="text-emerald-600" />
						<span className="font-medium">Published successfully</span>
					</div>
					<p className="wr-publish-success__title">{article.seo_title || form.keyword || 'Untitled article'}</p>
					{article.published_at ? (
						<p className="text-[11px] text-muted-foreground">{formatPublishedAt(article.published_at)}</p>
					) : null}
					<a
						href={article.published_url}
						target="_blank"
						rel="noreferrer"
						className="wr-publish-success__url"
					>
						{article.published_url}
					</a>
					<div className="flex flex-wrap gap-2 pt-1">
						<Button size="sm" variant="outline" onClick={() => window.open(article.published_url, '_blank', 'noopener,noreferrer')}>
							<ExternalLink size={14} /> Open Article
						</Button>
						<Button size="sm" variant="ghost" onClick={() => copyText(article.published_url, 'URL')}>
							<Copy size={14} /> Copy URL
						</Button>
						<Button size="sm" variant="ghost" onClick={() => copyText(article.seo_title || form.keyword, 'Title')}>
							<Copy size={14} /> Copy Title
						</Button>
					</div>
				</div>
			) : null}

			<div className="wr-atelier__shell">
				<aside className="wr-atelier__config p-4 space-y-3">
					<div>
						<h2 className="font-display text-lg font-semibold">Writer Configuration</h2>
						<p className="text-[11px] text-muted-foreground">Shape tone, structure, and publish targets.</p>
					</div>

					<form onSubmit={generate} className="space-y-3">
						<Section id="basics" open={openSections.basics} onToggle={toggleSection}>
							<Select label="Website" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
								{sites.length === 0 ? (
									<option value="">No websites connected</option>
								) : (
									sites.map((s) => (
										<option key={s.id} value={s.id}>
											{s.name} {s.status === 'connected' || s.status === 'active' ? '(connected)' : `(${s.status})`}
										</option>
									))
								)}
							</Select>
						<Input label="Main keyword" required value={form.keyword} onChange={set('keyword')} placeholder="easy vegan lasagna" />
						<Input label="Secondary keywords" value={form.secondary} onChange={set('secondary')} placeholder="plant-based, dairy-free" />
						<div className="grid grid-cols-2 gap-3">
							<Input label="Country" value={form.country} onChange={set('country')} />
							<Select label="Language" value={form.language} onChange={set('language')}>
									{['English', 'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Dutch', 'Arabic'].map((l) => (
										<option key={l}>{l}</option>
									))}
							</Select>
						</div>
						</Section>

						<Section id="content" open={openSections.content} onToggle={toggleSection}>
						<Select label="Article length" value={form.length} onChange={set('length')}>
							<option>Short (600-900 words)</option>
							<option>Medium (1000-1500 words)</option>
							<option>Long (1800-2500 words)</option>
						</Select>
						<div className="grid grid-cols-2 gap-3">
							<Select label="Tone" value={form.tone} onChange={set('tone')}>
									{['Friendly', 'Professional', 'Casual', 'Enthusiastic', 'Authoritative'].map((t) => (
										<option key={t}>{t}</option>
									))}
							</Select>
								<Select label="Number of headings" value={form.headings} onChange={set('headings')}>
									{['3', '4', '5', '6', '7'].map((n) => (
										<option key={n}>{n}</option>
									))}
							</Select>
						</div>
							<Select label="Reading level" value={form.readingLevel} onChange={set('readingLevel')}>
								{['General', 'Beginner', 'Intermediate', 'Advanced'].map((level) => (
									<option key={level}>{level}</option>
								))}
							</Select>
							<Select label="SEO level" value={form.seoLevel} onChange={set('seoLevel')}>
								{['Light', 'Balanced', 'Aggressive'].map((level) => (
									<option key={level}>{level}</option>
								))}
							</Select>
							<label className="wr-slider">
								<span className="flex items-center justify-between text-sm font-medium">
									Creativity
									<span className="text-xs text-muted-foreground">{form.creativity}%</span>
								</span>
								<input
									type="range"
									min="0"
									max="100"
									value={form.creativity}
									onChange={(e) => setForm((f) => ({ ...f, creativity: Number(e.target.value) }))}
								/>
							</label>
						</Section>

						<Section id="options" open={openSections.options} onToggle={toggleSection}>
							<OptionToggle label="Table of Contents" checked={options.toc} onChange={setOption('toc')} />
							<OptionToggle label="FAQ" checked={options.faq} onChange={setOption('faq')} />
							<OptionToggle label="Recipe Card" checked={options.recipe} onChange={setOption('recipe')} />
							<OptionToggle label="Nutrition" checked={options.nutrition} onChange={setOption('nutrition')} />
							<OptionToggle label="Internal Links" checked={options.internalLinks} onChange={setOption('internalLinks')} />
							<OptionToggle label="External Links" checked={options.externalLinks} onChange={setOption('externalLinks')} />
							<OptionToggle label="Conclusion" checked={options.conclusion} onChange={setOption('conclusion')} />
						</Section>

						<Section id="images" open={openSections.images} onToggle={toggleSection}>
							<div className="space-y-2">
								<p className="text-sm font-medium">Featured Image</p>
								{article?.featured_image ? (
									<div className="wr-image-preview">
										<img src={article.featured_image} alt="Featured" />
									</div>
								) : (
									<p className="text-[11px] text-muted-foreground">No featured image yet.</p>
								)}
								<div className="flex flex-wrap gap-2">
									<input
										ref={featuredInputRef}
										type="file"
										accept="image/*"
										className="hidden"
										onChange={(e) => uploadFeaturedImage(e.target.files?.[0])}
									/>
									<Button
										type="button"
										size="sm"
										variant="outline"
										disabled={imageBusy}
										onClick={() => featuredInputRef.current?.click()}
									>
										{imageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload size={14} />}
										{article?.featured_image ? 'Replace Image' : 'Upload Featured Image'}
						</Button>
									{article?.featured_image ? (
										<Button type="button" size="sm" variant="ghost" disabled={imageBusy} onClick={removeFeaturedImage}>
											<Trash2 size={14} /> Remove Image
										</Button>
									) : null}
								</div>
							</div>

							<div className="space-y-2 pt-1">
								<p className="text-sm font-medium">Additional Images</p>
								<p className="text-[11px] text-muted-foreground">These images can be inserted into the article later.</p>
								<input
									ref={galleryInputRef}
									type="file"
									accept="image/*"
									multiple
									className="hidden"
									onChange={(e) => uploadGalleryImages(e.target.files)}
								/>
								<input
									ref={replaceGalleryInputRef}
									type="file"
									accept="image/*"
									className="hidden"
									onChange={(e) => replaceGalleryImage(e.target.files?.[0])}
								/>
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={imageBusy}
									onClick={() => galleryInputRef.current?.click()}
								>
									{imageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload size={14} />}
									Upload Images
								</Button>
								{normalizeGallery(article?.gallery_images).length ? (
									<ul className="wr-gallery-list">
										{normalizeGallery(article.gallery_images).map((url, index) => (
											<li
												key={`${url}-${index}`}
												className="wr-gallery-item"
												draggable
												onDragStart={() => onGalleryDragStart(index)}
												onDragOver={(e) => e.preventDefault()}
												onDrop={() => onGalleryDrop(index)}
											>
												<span className="wr-gallery-item__handle" title="Drag to reorder">
													<GripVertical size={14} />
												</span>
												<img src={url} alt={`Gallery ${index + 1}`} />
												<div className="wr-gallery-item__actions">
													<button
														type="button"
														title="Replace"
														onClick={() => {
															replaceGalleryIndexRef.current = index;
															replaceGalleryInputRef.current?.click();
														}}
													>
														<Replace size={13} />
													</button>
													<button type="button" title="Delete" onClick={() => removeGalleryImage(index)}>
														<Trash2 size={13} />
													</button>
												</div>
											</li>
										))}
									</ul>
								) : (
									<p className="text-[11px] text-muted-foreground">No additional images yet.</p>
								)}
							</div>
						</Section>

						<Section id="prompt" open={openSections.prompt} onToggle={toggleSection}>
							<Textarea
								label="Custom AI instructions"
								rows={5}
								value={form.customPrompt}
								onChange={set('customPrompt')}
								placeholder={'Write any custom instructions for the AI...\nExamples:\nWrite like a professional food blogger.\nMake the tone friendly.\nUse short paragraphs.\nMention nutritional benefits.\nAvoid dairy.\nUse American English.'}
							/>
							<p className="text-[11px] text-muted-foreground -mt-1">
								Appended to the internal system prompt on Generate — it does not replace it.
							</p>
						</Section>

						<Section id="publishing" open={openSections.publishing} onToggle={toggleSection}>
							<Input label="WordPress category" value={form.wpCategory} onChange={set('wpCategory')} placeholder="Recipes" />
							<Input label="Tags" value={form.tags} onChange={set('tags')} placeholder="vegan, dinner, meal-prep" />
							<p className="text-[11px] text-muted-foreground -mt-1">Category and tags are sent to WordPress on publish.</p>
							<div className="flex flex-wrap gap-2">
								<Button type="button" size="sm" variant="outline" disabled={!article || publishing} onClick={() => publishToWp('draft')}>
									{publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload size={14} />}
									Publish Draft
								</Button>
								<Button type="button" size="sm" disabled={!article || publishing} onClick={() => publishToWp('publish')}>
									{publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink size={14} />}
									Publish Immediately
								</Button>
							</div>
							<div className="flex flex-wrap gap-2 pt-1">
								<Button type="button" size="sm" variant="ghost" disabled={!article || publishing} onClick={openScheduleModal}>
									Schedule
								</Button>
								<Button type="button" size="sm" variant="ghost" disabled={!article || saving} onClick={() => save('published')}>
									Save as published
								</Button>
							</div>
							{sites.length === 0 ? (
								<p className="text-xs text-muted-foreground inline-flex items-start gap-1.5">
									<Globe size={14} className="mt-0.5 shrink-0" />
									No WordPress websites yet. Connect one on the Websites page first.
								</p>
							) : null}
						</Section>

						<Button type="submit" disabled={generating || !writerPlanAllowed} className="w-full">
							{generating ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" />
									{STREAM_PHASES.find((step) => step.id === genPhase)?.label || 'Generating…'}
								</>
							) : (
								<>
									<Wand2 size={16} /> Generate article
								</>
							)}
						</Button>
					</form>
				</aside>

				<section className="wr-atelier__editor p-4 sm:p-5" ref={editorRef}>
					<div className="wr-stats">
						<span className="wr-stat"><strong>{stats.words}</strong> words</span>
						<span className="wr-stat"><strong>{stats.chars}</strong> chars</span>
						<span className="wr-stat"><strong>{stats.minutes || '—'}</strong> min read</span>
						<span className="wr-stat inline-flex items-center gap-1"><Clock size={12} /> Live editor</span>
					</div>

					{!article && !generating && genPhase !== 'failed' && genPhase !== 'cancelled' ? (
						<div className="wr-empty">
							<div className="wr-empty__icon">
								<PenLine size={26} strokeWidth={1.6} />
							</div>
							<p className="font-display text-xl font-semibold">Your writing studio is ready</p>
							<p className="mt-2 max-w-md text-sm text-muted-foreground">
								Set a keyword, tune the atelier controls, and generate a publish-ready recipe article with live SEO guidance.
							</p>
							<Button className="mt-5" onClick={generate} disabled={!form.keyword.trim() || generating || !writerPlanAllowed}>
								<Wand2 size={15} /> Start generating
							</Button>
						</div>
					) : null}

					{generating || genPhase === 'failed' || genPhase === 'cancelled' ? (
						<div className="space-y-4">
							<div className="wr-progress" role="status" aria-live="polite">
								{STREAM_PHASES.filter((step) => {
									if (step.id === 'failed') return genPhase === 'failed';
									if (step.id === 'cancelled' || step.id === 'cancelling') {
										return genPhase === 'cancelling' || genPhase === 'cancelled';
									}
									if (genPhase === 'failed' && step.id === 'completed') return false;
									if ((genPhase === 'cancelling' || genPhase === 'cancelled') && step.id === 'completed') return false;
									return true;
								}).map((step) => {
									const currentIndex = STREAM_PHASE_ORDER.indexOf(genPhase === 'idle' ? 'preparing' : genPhase);
									const stepIndex = STREAM_PHASE_ORDER.indexOf(step.id);
									const isFailed = genPhase === 'failed';
									const isCancelled = genPhase === 'cancelled';
									const isCancelling = genPhase === 'cancelling';
									const state = (isFailed && step.id === 'failed')
										|| (isCancelled && step.id === 'cancelled')
										|| (isCancelling && step.id === 'cancelling')
										? (isFailed ? 'is-failed' : isCancelled || isCancelling ? 'is-cancelled' : '')
										: !isFailed && !isCancelled && !isCancelling && stepIndex < currentIndex
											? 'is-done'
											: !isFailed && !isCancelled && !isCancelling && step.id === genPhase
												? 'is-active'
												: (isCancelling || isCancelled) && stepIndex < STREAM_PHASE_ORDER.indexOf('cancelling')
													? 'is-done'
													: '';
									return (
										<div key={step.id} className={`wr-progress__step ${state}`}>
											<span className="wr-progress__dot" />
											<span>{step.label}</span>
											{(state === 'is-active' || (state === 'is-cancelled' && step.id === 'cancelling')) ? (
												<span className="ml-auto"><Badge tone="amber">In progress</Badge></span>
											) : null}
											{state === 'is-done' ? (
												<span className="ml-auto text-[11px] text-muted-foreground">Done</span>
											) : null}
											{state === 'is-failed' ? (
												<span className="ml-auto"><Badge tone="red">Failed</Badge></span>
											) : null}
											{state === 'is-cancelled' && step.id === 'cancelled' ? (
												<span className="ml-auto"><Badge tone="amber">Cancelled</Badge></span>
											) : null}
										</div>
									);
								})}
							</div>

							{generating ? (
								<div className="wr-stream-status">
									<Spinner className="h-4 w-4 text-primary" />
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium text-foreground">
											{genPhase === 'cancelling'
												? 'Cancelling...'
												: (STREAM_PHASES.find((step) => step.id === genPhase)?.label || 'Generating...')}
										</p>
										<p className="text-[11px] text-muted-foreground">
											{genPhase === 'cancelling'
												? 'Stopping the stream. Partial text already received will be kept.'
												: 'Live stream progress — no estimated percentages.'}
										</p>
									</div>
									{genPhase !== 'cancelling' ? (
										<Button size="sm" variant="outline" type="button" onClick={cancelGeneration}>
											Cancel
										</Button>
									) : null}
								</div>
							) : null}

							{genPhase === 'cancelled' ? (
								<div className="wr-stream-cancelled">
									<p className="text-sm font-medium">Cancelled</p>
									<p className="mt-1 text-[12px] text-muted-foreground">
										Generation stopped. Your inputs and any streamed text below were preserved. Generate again when ready.
									</p>
									<div className="mt-3 flex flex-wrap gap-2">
										<Button size="sm" type="button" onClick={generate} disabled={generating || !writerPlanAllowed}>
											<Wand2 size={14} /> Generate again
										</Button>
									</div>
								</div>
							) : null}

							{genPhase === 'failed' && generationError ? (
								<div className="wr-stream-error">
									<div className="flex items-start gap-2">
										<AlertCircle size={16} className="mt-0.5 shrink-0 text-destructive" />
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium">{generationError.title}</p>
											<p className="mt-1 text-[12px] text-muted-foreground">{generationError.description}</p>
											<p className="mt-2 text-[11px] text-muted-foreground">
												Your keyword, settings, and prompt were kept. You can retry without re-entering them.
											</p>
											<div className="mt-3 flex flex-wrap gap-2">
												<Button size="sm" type="button" onClick={generate} disabled={generating || !writerPlanAllowed}>
													<RefreshCw size={14} /> Retry generation
												</Button>
											</div>
										</div>
									</div>
								</div>
							) : null}

							{(generating || stream || genPhase === 'cancelled') ? (
								<pre className="wr-stream" ref={streamRef}>
									{stream || (generating ? 'Waiting for the first tokens…' : 'No streamed text was received before cancel.')}
								</pre>
							) : null}
						</div>
					) : null}

					{article && !generating ? (
						<div className="space-y-4">
							<div className="grid gap-3">
							<Input label="SEO title" value={article.seo_title || ''} onChange={(e) => upd('seo_title', e.target.value)} />
							<Textarea label="Meta description" rows={2} value={article.meta_description || ''} onChange={(e) => upd('meta_description', e.target.value)} />
							<Input label="Slug" value={article.slug || ''} onChange={(e) => upd('slug', e.target.value)} />
										</div>

							<article className="wr-doc">
								<h1 className="wr-doc__title">{article.seo_title || form.keyword}</h1>
								<p className="wr-doc__meta">{article.meta_description}</p>
								<div className="wr-doc__body" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
								{article.recipe_schema ? (
									<div className="wr-recipe">✓ JSON-LD Recipe Schema included — ready for rich results.</div>
								) : null}
							</article>

							<div className="space-y-2">
								<p className="text-sm font-medium">Edit sections</p>
								<p className="text-[11px] text-muted-foreground -mt-1">
									Reorder, add, split, merge, or delete body sections without regenerating. Structural edits mark the draft unsaved.
								</p>
								<WriterSectionBlocks
									article={article}
									form={form}
									writerPlanAllowed={writerPlanAllowed}
									onPlanLocked={(access) => openWriterUpgrade(access || null)}
									onChangeArticle={(updater) => {
										setArticle((prev) => {
											if (!prev) return prev;
											const next = typeof updater === 'function' ? updater(prev) : updater;
											return next;
										});
									}}
								/>
								</div>

							<div className="wr-inline-tools">
								{INLINE_TOOLS.map((tool) => {
									const Icon = tool.icon;
									return (
										<Button key={tool.id} size="sm" variant="ghost" type="button" onClick={() => notifyInlineTool(tool.label)}>
											<Icon size={13} /> {tool.label}
										</Button>
									);
								})}
							</div>
						</div>
					) : null}
				</section>

				<aside className="wr-atelier__assist p-4 space-y-3">
								<div>
						<h2 className="font-display text-lg font-semibold">AI Assistant</h2>
						<p className="text-[11px] text-muted-foreground">SEO, outline, and social previews.</p>
									</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>SEO Score</span><Search size={13} /></div>
						<div className="wr-score">
							<span className="wr-score__value">{insights.seo}</span>
							<span className="text-xs text-muted-foreground">/ 100</span>
								</div>
						<div className="wr-meter"><span style={{ width: `${insights.seo}%` }} /></div>
								</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>Keyword Usage</span><Hash size={13} /></div>
						<div className="wr-score">
							<span className="wr-score__value" style={{ fontSize: '1.35rem' }}>{insights.keyword}</span>
							<span className="text-xs text-muted-foreground">coverage</span>
						</div>
						<div className="wr-meter"><span style={{ width: `${insights.keyword}%` }} /></div>
						<p className="mt-2 text-[11px] text-muted-foreground">Based on main + secondary keyword presence.</p>
					</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>Readability</span><BookOpen size={13} /></div>
						<div className="wr-score">
							<span className="wr-score__value" style={{ fontSize: '1.35rem' }}>{insights.readability}</span>
							<span className="text-xs text-muted-foreground">score</span>
						</div>
						<div className="wr-meter"><span style={{ width: `${insights.readability}%` }} /></div>
					</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>Outline</span><LayoutList size={13} /></div>
						{insights.outline.length ? (
							<ul className="wr-outline">
								{insights.outline.map((item) => <li key={item}>{item}</li>)}
							</ul>
						) : (
							<p className="text-xs text-muted-foreground">Outline appears after generation.</p>
						)}
					</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>Missing Sections</span><AlertCircle size={13} /></div>
						<div className="wr-chip-list">
							{insights.missing.map((item) => <span key={item} className="wr-chip">{item}</span>)}
						</div>
							</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>Meta Title Preview</span></div>
						<div className="wr-preview-box">
							<div className="wr-preview-box__label">Google-style title</div>
							{article?.seo_title || 'Your SEO title will preview here'}
								</div>
					</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>Meta Description Preview</span></div>
						<div className="wr-preview-box">
							<div className="wr-preview-box__label">Snippet</div>
							{article?.meta_description || 'Meta description preview appears after writing.'}
						</div>
					</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>Pinterest Title Suggestions</span></div>
						<div className="space-y-2">
							{insights.pinTitles.map((title) => (
								<div key={title} className="wr-preview-box text-[13px]">{title}</div>
							))}
						</div>
					</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>Pinterest Description Suggestions</span></div>
						<div className="space-y-2">
							{insights.pinDescriptions.map((desc) => (
								<div key={desc} className="wr-preview-box text-[12px] text-muted-foreground">{desc}</div>
							))}
						</div>
					</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>Facebook Post Preview</span><Facebook size={13} /></div>
						<div className="wr-preview-box whitespace-pre-wrap text-[12px]">{insights.fbPreview || 'Social preview unlocks after generation.'}</div>
					</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>Image Prompt Preview</span><ImageIcon size={13} /></div>
						<div className="wr-preview-box text-[12px] text-muted-foreground">{insights.imagePrompt}</div>
					</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>Estimated AI Credits</span><Coins size={13} /></div>
						<p className="font-display text-2xl font-semibold text-primary">
							{creditEstimate == null ? '—' : Number(creditEstimate).toFixed(Number.isInteger(creditEstimate) ? 0 : 1)}
						</p>
						<p className="mt-1 text-[11px] text-muted-foreground">
							From platform Credit Engine (`ai_writer`). Charged on successful generate.
						</p>
					</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>Generation History</span><History size={13} /></div>
						{history.length === 0 ? (
							<p className="text-xs text-muted-foreground">Completed generations in this session appear here.</p>
						) : (
							<div className="space-y-2">
								{history.map((item) => (
									<button key={item.id} type="button" className="wr-history-item" onClick={() => restoreHistory(item)}>
										<p className="truncate text-sm font-medium">{item.title}</p>
										<p className="mt-0.5 text-[11px] text-muted-foreground">
											{item.keyword} · {new Date(item.at).toLocaleTimeString()}
										</p>
									</button>
								))}
										</div>
								)}
							</div>

					<div className="wr-assist-card">
						<div className="wr-assist-card__title"><span>Recent Drafts</span><FileText size={13} /></div>
						{recentDrafts.length === 0 ? (
							<p className="text-xs text-muted-foreground">Saved articles will show up here.</p>
						) : (
							<div className="space-y-2">
								{recentDrafts.map((draft) => (
									<button key={draft.id} type="button" className="wr-draft-item" onClick={() => openDraft(draft)}>
										<p className="truncate text-sm font-medium">{draft.seo_title || draft.keyword || 'Untitled'}</p>
										<p className="mt-0.5 text-[11px] text-muted-foreground">
											{draft.status || 'draft'} · {draft.created ? new Date(draft.created).toLocaleDateString() : '—'}
										</p>
									</button>
								))}
							</div>
					)}
				</div>
				</aside>
			</div>

			<UpgradeModal
				open={upgradeOpen}
				onClose={() => setUpgradeOpen(false)}
				templateName="AI Writer"
				templateId="aiWriter"
				access={upgradeAccess}
				sourcePage="ai_writer"
				requiredFeatureKeys={['aiWriter']}
			/>

			<WriterScheduleModal
				open={scheduleOpen}
				onClose={() => !publishing && setScheduleOpen(false)}
				onSubmit={handleScheduleSubmit}
				submitting={publishing}
			/>
		</div>
	);
}
