import { useEffect, useMemo, useRef, useState } from 'react';
import {
	PenLine, Wand2, Save, Loader2, Globe, Upload, ExternalLink, ChevronDown,
	FileText, Settings2, ListChecks, Send, Copy, Download, RefreshCw,
	Sparkles, Search, BookOpen, LayoutList, AlertCircle, Hash, Clock,
	Facebook, Image as ImageIcon, Coins, History, Languages, Type,
} from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import apiServerClient from '@/lib/apiServerClient';
import { generateText, extractJson } from '@/lib/aiGenerate';
import { Badge, Button, Input, Select, Textarea, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
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
	{ id: 'publishing', label: 'Publishing', icon: Send },
];

const GEN_STEPS = [
	{ id: 'research', label: 'Research' },
	{ id: 'outline', label: 'Outline' },
	{ id: 'writing', label: 'Writing' },
	{ id: 'recipe', label: 'Recipe' },
	{ id: 'seo', label: 'SEO' },
	{ id: 'review', label: 'Final Review' },
];

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

function estimateCredits(length) {
	if (String(length).startsWith('Short')) return 1.2;
	if (String(length).startsWith('Long')) return 2.8;
	return 1.9;
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
	const [form, setForm] = useState(initForm);
	const [options, setOptions] = useState(initOptions);
	const [generating, setGenerating] = useState(false);
	const [stream, setStream] = useState('');
	const [article, setArticle] = useState(null);
	const [articleBaseline, setArticleBaseline] = useState(null);
	const [saving, setSaving] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [sites, setSites] = useState([]);
	const [siteId, setSiteId] = useState('');
	const [recentDrafts, setRecentDrafts] = useState([]);
	const [history, setHistory] = useState([]);
	const [genStep, setGenStep] = useState(0);
	const [openSections, setOpenSections] = useState({
		basics: true,
		content: true,
		options: true,
		publishing: true,
	});

	const streamRef = useRef(null);
	const editorRef = useRef(null);

	useEffect(() => {
		(async () => {
			try {
				const response = await apiServerClient.fetch('/websites', { method: 'GET' });
				const payload = await response.json().catch(() => ([]));
				const rows = Array.isArray(payload) ? payload : (payload.items || []);
				setSites(rows);
				const connected = rows.find((r) => r.status === 'connected' || r.status === 'active') || rows[0];
				if (connected) setSiteId(connected.id);
			} catch {
				setSites([]);
			}
		})();
	}, []);

	const loadRecentDrafts = async () => {
		try {
			const ownerId = pb.authStore.record?.id;
			if (!ownerId) return;
			const rows = await pb.collection('articles').getList(1, 6, {
				sort: '-created',
				filter: pb.filter('owner = {:owner}', { owner: ownerId }),
			});
			setRecentDrafts(rows.items || []);
		} catch {
			setRecentDrafts([]);
		}
	};

	useEffect(() => {
		loadRecentDrafts();
	}, []);

	useEffect(() => {
		if (!generating) return undefined;
		setGenStep(0);
		const timers = [
			window.setTimeout(() => setGenStep(1), 900),
			window.setTimeout(() => setGenStep(2), 2200),
			window.setTimeout(() => setGenStep(3), 4200),
			window.setTimeout(() => setGenStep(4), 6200),
			window.setTimeout(() => setGenStep(5), 8200),
		];
		return () => timers.forEach((id) => window.clearTimeout(id));
	}, [generating]);

	useEffect(() => {
		if (!generating || !streamRef.current) return;
		streamRef.current.scrollTop = streamRef.current.scrollHeight;
	}, [stream, generating]);

	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
	const setOption = (k) => (value) => setOptions((prev) => ({ ...prev, [k]: value }));
	const toggleSection = (id) => setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
	const upd = (k, v) => setArticle((a) => ({ ...a, [k]: v }));

	const isDirty = useMemo(() => {
		if (!article) return false;
		return JSON.stringify(article) !== JSON.stringify(articleBaseline);
	}, [article, articleBaseline]);

	const stats = useMemo(() => {
		const text = article ? articlePlainText(article) : stream;
		const words = countWords(text);
		const chars = stripHtml(text).length;
		const minutes = Math.max(1, Math.round(words / 200)) || 0;
		return { words, chars, minutes: words ? minutes : 0 };
	}, [article, stream]);

	const insights = useMemo(() => scoreArticle(article, form), [article, form]);
	const creditEstimate = useMemo(() => estimateCredits(form.length), [form.length]);

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

		return `Write a complete SEO-optimized food blog article.
Main keyword: ${form.keyword}
Secondary keywords: ${form.secondary || 'none'}
Country: ${form.country}
Language: ${form.language}
Article length: ${form.length}
Tone: ${form.tone}
Number of H2/H3 headings: ${form.headings}
${include.length ? `Include: ${include.join(', ')}.` : ''}
Respond ONLY with the JSON object described in your instructions.`;
	};

	const generate = async (event) => {
		event?.preventDefault?.();
		if (!form.keyword.trim()) {
			toast({ variant: 'destructive', title: 'Main keyword required', description: 'Add a keyword to start writing.' });
			return;
		}
		setGenerating(true);
		setArticle(null);
		setArticleBaseline(null);
		setStream('');
		try {
			const { text } = await generateText(buildPrompt(), { onChunk: setStream });
			const json = extractJson(text);
			if (!json) throw new Error('Could not parse the AI response. Try again.');
			const next = { ...json, sections: json.sections || [], faq: json.faq || [] };
			setArticle(next);
			setArticleBaseline(next);
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
			toast({ variant: 'destructive', title: 'Generation failed', description: err?.message });
		} finally {
			setGenerating(false);
			setGenStep(GEN_STEPS.length - 1);
		}
	};

	const save = async (status) => {
		if (!article) return;
		setSaving(true);
		try {
			await pb.collection('articles').create({
				owner: pb.authStore.record.id,
				keyword: form.keyword,
				seo_title: article.seo_title,
				meta_description: article.meta_description,
				slug: article.slug,
				language: form.language,
				country: form.country,
				tone: form.tone,
				body: article,
				status,
				...(status === 'scheduled' && { scheduled_at: new Date(Date.now() + 86400000).toISOString() }),
			});
			toast({ title: 'Saved', description: `Article saved as ${status}.` });
			setArticle(null);
			setArticleBaseline(null);
			setForm(initForm);
			setStream('');
			await loadRecentDrafts();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	const publishToWp = async (wpStatus, extras = {}) => {
		if (!article) return;
		const site = sites.find((s) => s.id === siteId);
		if (!site) {
			toast({ variant: 'destructive', title: 'No website selected', description: 'Add and connect a WordPress site first.' });
			return;
		}
		setPublishing(true);
		try {
			const endpoint = extras.scheduledAt ? '/wordpress/schedule' : '/wordpress/publish';
			const res = await apiServerClient.fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					siteId: site.id,
					websiteId: site.id,
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
					idempotencyKey: `writer-${site.id}-${article.slug || form.keyword}-${wpStatus}-${extras.scheduledAt || 'now'}`,
				}),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || data.ok === false) {
				throw new Error(data.message || data.error || 'Publish failed');
			}

			await pb.collection('articles').create({
				owner: pb.authStore.record.id,
				keyword: form.keyword,
				seo_title: article.seo_title,
				meta_description: article.meta_description,
				slug: article.slug,
				language: form.language,
				country: form.country,
				tone: form.tone,
				body: article,
				status: extras.scheduledAt ? 'scheduled' : (wpStatus === 'publish' ? 'published' : 'draft'),
			}).catch(() => {});

			if (data.queued && !data.link) {
				toast({
					title: 'Publish queued',
					description: 'WordPress job is processing in the background. Check history shortly.',
				});
			} else {
				toast({
					title: extras.scheduledAt
						? 'Scheduled on WordPress'
						: (wpStatus === 'publish' ? 'Published to WordPress' : 'Draft sent to WordPress'),
					description: data.link || data.url || (data.id ? `Post #${data.id} created.` : 'Job accepted.'),
				});
			}
			setArticleBaseline(article);
			await loadRecentDrafts();
		} catch (err) {
			toast({ variant: 'destructive', title: 'WordPress error', description: err?.message });
		} finally {
			setPublishing(false);
		}
	};

	const scheduleToWp = async () => {
		if (!article) return;
		const when = window.prompt('Schedule publish time (ISO or local datetime)', new Date(Date.now() + 3600000).toISOString().slice(0, 16));
		if (!when) return;
		const scheduledAt = new Date(when);
		if (Number.isNaN(scheduledAt.getTime())) {
			toast({ variant: 'destructive', title: 'Invalid date', description: 'Enter a valid schedule time.' });
			return;
		}
		await publishToWp('future', { scheduledAt: scheduledAt.toISOString() });
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
		setArticle(item.snapshot);
		setArticleBaseline(item.snapshot);
		if (item.formSnapshot) setForm((prev) => ({ ...prev, ...item.formSnapshot }));
		toast({ title: 'Restored', description: item.title });
	};

	const openDraft = (draft) => {
		const body = draft.body && typeof draft.body === 'object' ? draft.body : null;
		if (!body) {
			toast({ variant: 'destructive', title: 'Draft unavailable', description: 'This draft has no editable body.' });
			return;
		}
		setArticle({ ...body, sections: body.sections || [], faq: body.faq || [] });
		setArticleBaseline({ ...body, sections: body.sections || [], faq: body.faq || [] });
		setForm((prev) => ({
			...prev,
			keyword: draft.keyword || prev.keyword,
			language: draft.language || prev.language,
			country: draft.country || prev.country,
			tone: draft.tone || prev.tone,
		}));
		toast({ title: 'Draft loaded', description: draft.seo_title || draft.keyword });
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
	}, [article, saving, form]);

	const renderedHtml = useMemo(() => {
		if (!article) return '';
		return composeHtml(article).replace(/<script[\s\S]*?<\/script>/gi, '');
	}, [article]);

	return (
		<div className="wr-atelier">
			<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Chef IA Studio</p>
					<h1 className="font-display text-3xl font-semibold tracking-tight">AI Writer</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Craft publish-ready SEO recipe articles in a premium writing atelier — then push them to WordPress.
					</p>
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
							<span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground">Synced</span>
						)
					) : (
						<span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground">Ready to write</span>
					)}
					<span className="hidden text-[11px] text-muted-foreground sm:inline">Ctrl+S</span>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button size="sm" onClick={generate} disabled={generating}>
						{generating ? <Spinner className="h-4 w-4" /> : <Wand2 size={14} />}
						Generate
					</Button>
					<Button size="sm" variant="outline" onClick={generate} disabled={generating || !form.keyword.trim()}>
						<RefreshCw size={14} /> Regenerate
					</Button>
					<Button size="sm" variant="outline" onClick={() => save('draft')} disabled={!article || saving}>
						{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save size={14} />}
						Save Draft
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
							<p className="text-[11px] text-muted-foreground -mt-1">UI only — not sent to the model yet.</p>
							<Select label="SEO level" value={form.seoLevel} onChange={set('seoLevel')}>
								{['Light', 'Balanced', 'Aggressive'].map((level) => (
									<option key={level}>{level}</option>
								))}
							</Select>
							<p className="text-[11px] text-muted-foreground -mt-1">UI only — preview control.</p>
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
								<span className="text-[11px] text-muted-foreground">UI only — does not change generation yet.</span>
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
								<Button type="button" size="sm" variant="ghost" disabled={!article || publishing} onClick={scheduleToWp}>
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

						<Button type="submit" disabled={generating} className="w-full">
							{generating ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" /> Generating…
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

					{!article && !generating ? (
						<div className="wr-empty">
							<div className="wr-empty__icon">
								<PenLine size={26} strokeWidth={1.6} />
							</div>
							<p className="font-display text-xl font-semibold">Your writing studio is ready</p>
							<p className="mt-2 max-w-md text-sm text-muted-foreground">
								Set a keyword, tune the atelier controls, and generate a publish-ready recipe article with live SEO guidance.
							</p>
							<Button className="mt-5" onClick={generate} disabled={!form.keyword.trim()}>
								<Wand2 size={15} /> Start generating
							</Button>
						</div>
					) : null}

					{generating ? (
						<div className="space-y-4">
							<div className="wr-progress">
								{GEN_STEPS.map((step, index) => {
									const state = index < genStep ? 'is-done' : index === genStep ? 'is-active' : '';
									return (
										<div key={step.id} className={`wr-progress__step ${state}`}>
											<span className="wr-progress__dot" />
											<span>{step.label}</span>
											{index === genStep ? <span className="ml-auto"><Badge tone="amber">In progress</Badge></span> : null}
											{index < genStep ? <span className="ml-auto text-[11px] text-muted-foreground">Done</span> : null}
										</div>
									);
								})}
							</div>
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Spinner className="h-4 w-4 text-primary" />
								Writing your article section by section…
							</div>
							<pre className="wr-stream" ref={streamRef}>{stream || 'Waiting for the first tokens…'}</pre>
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

							<div className="grid gap-3">
								<Textarea label="Introduction (edit)" rows={3} value={article.introduction || ''} onChange={(e) => upd('introduction', e.target.value)} />
								<div>
									<p className="mb-1.5 text-sm font-medium">Sections</p>
									<div className="max-h-72 space-y-2 overflow-auto rounded-xl border border-border p-3">
										{article.sections?.map((s, i) => (
											<div key={i} className="rounded-lg bg-secondary/60 p-2.5">
												<p className="text-sm font-semibold uppercase text-primary">{s.level || 'h2'} · {s.heading}</p>
												<p className="mt-1 text-xs text-muted-foreground">{stripHtml(s.content)}</p>
											</div>
										))}
									</div>
								</div>
								{article.faq?.length > 0 ? (
									<div>
										<p className="mb-1.5 text-sm font-medium">FAQ ({article.faq.length})</p>
										<div className="max-h-48 space-y-2 overflow-auto rounded-xl border border-border p-3 text-sm">
											{article.faq.map((f, i) => (
												<div key={i}>
													<p className="font-medium">{f.question}</p>
													<p className="text-xs text-muted-foreground">{f.answer}</p>
												</div>
											))}
										</div>
									</div>
								) : null}
								<Textarea label="Conclusion (edit)" rows={3} value={article.conclusion || ''} onChange={(e) => upd('conclusion', e.target.value)} />
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
						<p className="font-display text-2xl font-semibold text-primary">{creditEstimate.toFixed(1)}</p>
						<p className="mt-1 text-[11px] text-muted-foreground">Estimate from article length setting (UI guide).</p>
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
		</div>
	);
}
