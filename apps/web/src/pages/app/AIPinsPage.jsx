import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wand2, Sparkles, RefreshCw, Trash2, Pencil, Search, Globe, FileText, Send, CalendarClock, CheckSquare, Square, Download, Image as ImageIcon, Images } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import apiServerClient from '@/lib/apiServerClient';
import { generateText, extractJson } from '@/lib/aiGenerate';
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Spinner, Textarea } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import TemplatePreviewCard from '@/components/ai-pins/TemplatePreviewCard';
import ArticlePicker from '@/components/ai-pins/ArticlePicker';
import ArticlePreviewDrawer from '@/components/ai-pins/ArticlePreviewDrawer';
import ManualArticleForm from '@/components/ai-pins/ManualArticleForm';
import { createDefaultTemplateConfig, normalizeTemplateConfig } from '@/lib/pinTemplates';

const PIN_COUNTS = [1, 3, 5, 10];

function truncate(value, max = 160) {
	if (!value) {
		return '';
	}
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function safeArray(value) {
	if (!value) {
		return [];
	}
	if (Array.isArray(value)) {
		return value.map((item) => String(item).trim()).filter(Boolean);
	}
	if (typeof value === 'string') {
		return value
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);
	}
	return [];
}

function parsePinsFromText(text) {
	const object = extractJson(text);
	if (object?.pins && Array.isArray(object.pins)) {
		return object.pins;
	}

	const normalized = text.trim().replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/, '').trim();
	const start = normalized.indexOf('[');
	const end = normalized.lastIndexOf(']');
	if (start !== -1 && end !== -1 && end > start) {
		try {
			const parsed = JSON.parse(normalized.slice(start, end + 1));
			if (Array.isArray(parsed)) {
				return parsed;
			}
		} catch {
			// ignore
		}
	}

	return [];
}

function buildPinPrompt({ article, count, panel }) {
	return `You are a Pinterest SEO expert for blog traffic growth.
Return ONLY a valid JSON object in this exact shape:
{
  "pins": [
    {
      "title": "Pinterest SEO title",
      "description": "Pinterest description optimized for clicks",
      "overlayText": "short image overlay text",
      "suggestedKeywords": ["keyword1", "keyword2", "keyword3"],
      "suggestedHashtags": ["#tag1", "#tag2", "#tag3"],
      "imagePrompt": "detailed AI image prompt for a vertical Pinterest pin"
    }
  ]
}
Generate exactly ${count} pins.
Language: ${panel.language}
Target audience: ${panel.targetAudience}
Tone: ${panel.toneOfVoice}
Website article metadata:
Title: ${article.title}
Meta Description: ${article.metaDescription || ''}
URL: ${article.url}
Category: ${article.category || ''}
Featured Image: ${article.featuredImage || ''}
Optional guidance:
Preferred pin title seed: ${panel.pinTitle || ''}
Preferred description seed: ${panel.pinDescription || ''}
Preferred overlay seed: ${panel.textOverlay || ''}
Output only JSON and no markdown.`;
}

function mapArticleFromApi(item) {
	return {
		id: item.id,
		websiteId: item.websiteId,
		url: item.url,
		slug: item.slug,
		title: item.title,
		metaDescription: item.metaDescription || '',
		featuredImage: item.featuredImage || '',
		publishDate: item.publishDate,
		lastModifiedDate: item.lastModifiedDate,
		category: item.category || '',
		author: item.author || '',
		language: item.language || '',
		status: item.status,
	};
}

function mapSavedPin(pin) {
	return {
		id: pin.id,
		articleId: pin.articleId,
		websiteId: pin.websiteId,
		title: pin.title,
		description: pin.description,
		overlayText: pin.overlay_text,
		imagePrompt: pin.image_prompt,
		imageUrl: pin.image_url || '',
		suggestedKeywords: safeArray(pin.suggested_keywords),
		suggestedHashtags: safeArray(pin.suggested_hashtags),
		status: pin.status,
		accountId: pin.pinterest_account_id || '',
		accountLabel: pin.pinterest_account_label || '',
		scheduledAt: pin.scheduled_at || '',
		scheduledTimezone: pin.scheduled_timezone || '',
		boardId: pin.pinterest_board_id || '',
		boardName: pin.pinterest_board_name || '',
		pinterestPinUrl: pin.pinterest_pin_url || '',
		publishError: pin.publish_error || '',
		targetAudience: pin.target_audience,
		toneOfVoice: pin.tone_of_voice,
		language: pin.language,
		created: pin.created,
		updated: pin.updated,
	};
}

function mapTemplate(record) {
	return {
		id: record.id,
		name: record.name,
		configuration: normalizeTemplateConfig(record.configuration || {}),
		isDefault: Boolean(record.is_default),
	};
}

export default function AIPinsPage() {
	const { toast } = useToast();
	const previousStatusesRef = useRef(new Map());
	const [websites, setWebsites] = useState([]);
	const [websiteId, setWebsiteId] = useState('');
	const [articles, setArticles] = useState([]);
	const [articleCategories, setArticleCategories] = useState([]);
	const [articleSearch, setArticleSearch] = useState('');
	const [articleStatus, setArticleStatus] = useState('');
	const [articleCategory, setArticleCategory] = useState('');
	const [articlePage, setArticlePage] = useState(1);
	const [articleTotalPages, setArticleTotalPages] = useState(1);
	const [previewArticle, setPreviewArticle] = useState(null);
	const [manualOpen, setManualOpen] = useState(false);
	const [savingManual, setSavingManual] = useState(false);
	const [activeArticleId, setActiveArticleId] = useState('');
	const [selectedArticleIds, setSelectedArticleIds] = useState(new Set());
	const [loadingWebsites, setLoadingWebsites] = useState(true);
	const [loadingArticles, setLoadingArticles] = useState(false);
	const [loadingPins, setLoadingPins] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [loadingAccounts, setLoadingAccounts] = useState(false);
	const [loadingBoards, setLoadingBoards] = useState(false);
	const [editingPinId, setEditingPinId] = useState('');
	const [savedPins, setSavedPins] = useState([]);
	const [templates, setTemplates] = useState([]);
	const [loadingTemplates, setLoadingTemplates] = useState(false);
	const [selectedTemplateId, setSelectedTemplateId] = useState('');
	const [generatedPreviewPins, setGeneratedPreviewPins] = useState([]);
	const [savingGenerated, setSavingGenerated] = useState(false);
	const [generatingImages, setGeneratingImages] = useState(false);
	const [accounts, setAccounts] = useState([]);
	const [boards, setBoards] = useState([]);
	const [boardsByAccount, setBoardsByAccount] = useState({});
	const [selectedDraftPinIds, setSelectedDraftPinIds] = useState(new Set());
	const [selectedAccountId, setSelectedAccountId] = useState('');
	const [selectedBoardId, setSelectedBoardId] = useState('');
	const [scheduleAt, setScheduleAt] = useState('');
	const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
	const [panel, setPanel] = useState({
		pinTitle: '',
		pinDescription: '',
		textOverlay: '',
		targetAudience: 'Food bloggers and recipe creators',
		toneOfVoice: 'Friendly and persuasive',
		language: 'English',
		count: 3,
		imageMode: 'use_featured',
	});

	const activeArticle = useMemo(
		() => articles.find((article) => article.id === activeArticleId) || null,
		[articles, activeArticleId],
	);

	const selectedArticles = useMemo(
		() => articles.filter((article) => selectedArticleIds.has(article.id)),
		[articles, selectedArticleIds],
	);

	const draftPins = useMemo(
		() => savedPins.filter((pin) => pin.status !== 'published'),
		[savedPins],
	);

	const selectedDraftPins = useMemo(
		() => draftPins.filter((pin) => selectedDraftPinIds.has(pin.id)),
		[draftPins, selectedDraftPinIds],
	);

	const selectedTemplate = useMemo(
		() => templates.find((template) => template.id === selectedTemplateId) || null,
		[templates, selectedTemplateId],
	);

	const loadWebsites = async () => {
		setLoadingWebsites(true);
		try {
			const response = await apiServerClient.fetch('/websites', { method: 'GET' });
			const payload = await response.json().catch(() => []);
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to load websites (${response.status})`);
			}
			setWebsites(payload);
			if (payload.length > 0) {
				setWebsiteId((prev) => prev || payload[0].id);
			}
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoadingWebsites(false);
		}
	};

	const loadArticles = async () => {
		if (!websiteId) {
			setArticles([]);
			setArticleCategories([]);
			setArticleTotalPages(1);
			return;
		}

		setLoadingArticles(true);
		try {
			const query = new URLSearchParams({
				websiteId,
				page: String(articlePage),
				perPage: '20',
			});
			if (articleSearch.trim()) {
				query.set('search', articleSearch.trim());
			}
			if (articleStatus) {
				query.set('status', articleStatus);
			}
			if (articleCategory) {
				query.set('category', articleCategory);
			}

			const response = await apiServerClient.fetch(`/ai-pins/articles?${query.toString()}`, { method: 'GET' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to load articles (${response.status})`);
			}

			const mapped = (payload.items || []).map(mapArticleFromApi);
			setArticles(mapped);
			setArticleCategories(Array.isArray(payload.categories) ? payload.categories : []);
			setArticleTotalPages(payload.totalPages || 1);
			setActiveArticleId((prev) => (mapped.some((item) => item.id === prev) ? prev : mapped[0]?.id || ''));
			setSelectedArticleIds((prev) => {
				const next = new Set();
				for (const article of mapped) {
					if (prev.has(article.id)) {
						next.add(article.id);
					}
				}
				return next;
			});
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoadingArticles(false);
		}
	};

	const saveManualArticle = async (payload) => {
		setSavingManual(true);
		try {
			const response = await apiServerClient.fetch('/ai-pins/manual-articles', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...payload, websiteId }),
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(data?.message || `Failed to save article (${response.status})`);
			}
			const mapped = mapArticleFromApi(data);
			setManualOpen(false);
			setArticleStatus('imported');
			setArticlePage(1);
			toast({ title: 'Article added', description: 'Manual article is ready for pin generation.' });
			setSelectedArticleIds((prev) => new Set(prev).add(mapped.id));
			setActiveArticleId(mapped.id);
			await loadArticles();
		} finally {
			setSavingManual(false);
		}
	};

	const loadPins = async () => {
		if (!websiteId) {
			setSavedPins([]);
			return;
		}

		setLoadingPins(true);
		try {
			const pins = await pb.collection('ai_pins').getFullList({
				sort: '-created',
				filter: pb.filter('websiteId = {:websiteId}', { websiteId }),
			});
			const mappedPins = pins.map(mapSavedPin);

			for (const pin of mappedPins) {
				const previousStatus = previousStatusesRef.current.get(pin.id);
				if (previousStatus && previousStatus !== pin.status) {
					if (pin.status === 'published') {
						toast({ title: 'Publish successful', description: `Pin published: ${pin.title}` });
					}
					if (pin.status === 'failed') {
						toast({ variant: 'destructive', title: 'Publish failed', description: pin.publishError || `Pin failed: ${pin.title}` });
					}
				}
			}

			previousStatusesRef.current = new Map(mappedPins.map((pin) => [pin.id, pin.status]));
			setSavedPins(mappedPins);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoadingPins(false);
		}
	};

	const loadBoards = async () => {
		if (!selectedAccountId) {
			setBoards([]);
			setSelectedBoardId('');
			return;
		}

		setLoadingBoards(true);
		try {
			const response = await apiServerClient.fetch(`/pinterest/boards?accountId=${encodeURIComponent(selectedAccountId)}`, { method: 'GET' });
			if (response.status === 401) {
				setBoards([]);
				setSelectedBoardId('');
				return;
			}
			const payload = await response.json().catch(() => []);
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to load Pinterest boards (${response.status})`);
			}
			setBoards(Array.isArray(payload) ? payload : []);
			if (Array.isArray(payload) && payload.length > 0) {
				setSelectedBoardId((prev) => prev || payload[0].boardId);
			}
			setBoardsByAccount((prev) => ({
				...prev,
				[selectedAccountId]: Array.isArray(payload) ? payload : [],
			}));
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoadingBoards(false);
		}
	};

	const loadAccounts = async () => {
		setLoadingAccounts(true);
		try {
			const response = await apiServerClient.fetch('/pinterest/accounts?filter=active', { method: 'GET' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to load Pinterest accounts (${response.status})`);
			}
			const items = Array.isArray(payload.items) ? payload.items : [];
			setAccounts(items);
			if (items.length > 0) {
				setSelectedAccountId((prev) => prev || items[0].id);
			}
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoadingAccounts(false);
		}
	};

	const loadTemplates = async () => {
		setLoadingTemplates(true);
		try {
			const owner = pb.authStore.record?.id;
			const records = await pb.collection('ai_pin_templates').getFullList({
				sort: '-is_default,-updated',
				filter: pb.filter('owner = {:owner}', { owner }),
			});
			const mapped = records.map(mapTemplate);
			setTemplates(mapped);
			if (mapped.length > 0) {
				const fallback = mapped.find((template) => template.isDefault) || mapped[0];
				setSelectedTemplateId((prev) => prev || fallback.id);
			} else {
				setSelectedTemplateId('');
			}
		} catch (error) {
			toast({ variant: 'destructive', title: 'Template error', description: error.message });
		} finally {
			setLoadingTemplates(false);
		}
	};

	useEffect(() => {
		loadWebsites();
		loadAccounts();
		loadTemplates();
	}, []);

	useEffect(() => {
		loadBoards();
	}, [selectedAccountId]);

	useEffect(() => {
		setArticlePage(1);
		loadArticles();
		loadPins();
	}, [websiteId]);

	useEffect(() => {
		if (!websiteId) {
			return;
		}

		const interval = setInterval(() => {
			loadPins();
		}, 20000);

		return () => clearInterval(interval);
	}, [websiteId]);

	useEffect(() => {
		loadArticles();
	}, [articlePage, articleStatus, articleCategory]);

	useEffect(() => {
		const timeout = setTimeout(() => {
			setArticlePage(1);
			loadArticles();
		}, 250);

		return () => clearTimeout(timeout);
	}, [articleSearch]);

	useEffect(() => {
		if (!activeArticle) {
			setPanel((prev) => ({
				...prev,
				pinTitle: '',
				pinDescription: '',
				textOverlay: '',
			}));
			return;
		}

		setPanel((prev) => ({
			...prev,
			pinTitle: activeArticle.title || '',
			pinDescription: activeArticle.metaDescription || '',
			textOverlay: truncate(activeArticle.title || activeArticle.slug || '', 48),
			language: activeArticle.language || prev.language || 'English',
		}));
	}, [activeArticleId]);

	const toggleArticleSelection = (articleId) => {
		setSelectedArticleIds((prev) => {
			const next = new Set(prev);
			if (next.has(articleId)) {
				next.delete(articleId);
			} else {
				next.add(articleId);
			}
			return next;
		});
	};

	const createPinRecords = async ({ previewPins }) => {
		const records = [];
		for (const pin of previewPins) {
			const payload = {
				owner: pb.authStore.record.id,
				articleId: pin.articleId,
				websiteId: pin.websiteId,
				image_prompt: String(pin.imagePrompt || '').trim(),
				overlay_text: String(pin.overlayText || '').trim(),
				title: String(pin.title || 'Draft AI Pin').trim(),
				description: String(pin.description || '').trim(),
				image_url: String(pin.imageUrl || '').trim(),
				pinterest_account_id: String(pin.accountId || '').trim(),
				pinterest_account_label: String(pin.accountLabel || '').trim(),
				pinterest_board_id: String(pin.boardId || '').trim(),
				pinterest_board_name: String(pin.boardName || '').trim(),
				suggested_keywords: safeArray(pin.suggestedKeywords),
				suggested_hashtags: safeArray(pin.suggestedHashtags),
				target_audience: panel.targetAudience,
				tone_of_voice: panel.toneOfVoice,
				language: panel.language,
				status: 'draft',
				image_source: String(pin.imageSource || '').trim() || 'featured',
				image_generation_status: String(pin.imageGenerationStatus || '').trim() || 'idle',
				image_generation_error: String(pin.imageGenerationError || '').trim(),
			};
			const created = await pb.collection('ai_pins').create(payload);
			records.push(mapSavedPin(created));
		}
		return records;
	};

	const queuePreviewImageJobs = async (pins) => {
		if (pins.length === 0) {
			return [];
		}

		const response = await apiServerClient.fetch('/ai-pin-images/jobs', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				items: pins.map((pin) => ({
					clientToken: pin.tempId,
					articleId: pin.articleId,
					title: pin.title,
					description: pin.description,
					overlayText: pin.overlayText,
					keywords: safeArray(pin.suggestedKeywords),
					imagePrompt: pin.imagePrompt,
					category: pin.category,
					featuredImageUrl: pin.featuredImage,
					imageMode: 'generate_ai',
				})),
			}),
		});

		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(payload?.message || `Failed to queue image jobs (${response.status})`);
		}

		return Array.isArray(payload.items) ? payload.items : [];
	};

	const pollPreviewImageJobs = async (jobIds) => {
		if (!Array.isArray(jobIds) || jobIds.length === 0) {
			return;
		}

		setGeneratingImages(true);
		const doneStatuses = new Set(['completed', 'fallback', 'failed']);

		for (let attempt = 0; attempt < 40; attempt += 1) {
			const response = await apiServerClient.fetch(`/ai-pin-images/jobs?ids=${encodeURIComponent(jobIds.join(','))}`, { method: 'GET' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to poll image jobs (${response.status})`);
			}

			const jobs = Array.isArray(payload.items) ? payload.items : [];
			setGeneratedPreviewPins((prev) => prev.map((pin) => {
				const job = jobs.find((item) => item.clientToken === pin.tempId || item.id === pin.imageJobId);
				if (!job) {
					return pin;
				}

				return {
					...pin,
					imageJobId: job.id,
					imageUrl: job.imageUrl || pin.imageUrl || '',
					imageGenerationStatus: job.status,
					imageGenerationError: job.lastError || '',
					imageSource: job.status === 'completed' ? 'ai_generated' : job.status === 'fallback' ? 'featured_fallback' : pin.imageSource,
				};
			}));

			if (jobs.length > 0 && jobs.every((job) => doneStatuses.has(job.status))) {
				break;
			}

			await new Promise((resolve) => setTimeout(resolve, 2500));
		}

		setGeneratingImages(false);
	};

	const startPreviewImageGeneration = async (pins) => {
		if (panel.imageMode !== 'generate_ai') {
			setGeneratedPreviewPins((prev) => prev.map((pin) => ({
				...pin,
				imageUrl: pin.featuredImage || pin.imageUrl || '',
				imageSource: 'featured',
				imageGenerationStatus: 'completed',
				imageGenerationError: '',
			})));
			return;
		}

		const jobs = await queuePreviewImageJobs(pins);
		const jobIds = jobs.map((job) => job.id);
		setGeneratedPreviewPins((prev) => prev.map((pin) => {
			const job = jobs.find((item) => item.clientToken === pin.tempId);
			return job ? {
				...pin,
				imageJobId: job.id,
				imageGenerationStatus: job.status,
				imageGenerationError: job.lastError || '',
			} : pin;
		}));

		await pollPreviewImageJobs(jobIds);
	};

	const generatePinsForArticle = async (article, count) => {
		const prompt = buildPinPrompt({ article, count, panel });
		const { text } = await generateText(prompt);
		let pins = parsePinsFromText(text);

		if (!Array.isArray(pins) || pins.length === 0) {
			pins = Array.from({ length: count }).map((_, index) => ({
				title: `${article.title} | Pinterest Pin ${index + 1}`,
				description: article.metaDescription || `Discover insights from ${article.title}`,
				overlayText: truncate(panel.textOverlay || article.title || article.slug || 'Read now', 48),
				suggestedKeywords: [article.category || 'content strategy', 'pinterest seo', 'blog traffic'],
				suggestedHashtags: ['#pinteresttips', '#blogstrategy', '#contentmarketing'],
				imagePrompt: `Pinterest vertical pin, high-contrast composition, focus on ${article.title}, category ${article.category || 'blog'}, audience ${panel.targetAudience}, tone ${panel.toneOfVoice}, language ${panel.language}`,
			}));
		}

		return pins.slice(0, count);
	};

	const handleGenerate = async () => {
		if (!websiteId) {
			toast({ variant: 'destructive', title: 'Select website', description: 'Please select a website first.' });
			return;
		}

		const targets = selectedArticles.length > 0 ? selectedArticles : (activeArticle ? [activeArticle] : []);
		if (targets.length === 0) {
			toast({ variant: 'destructive', title: 'Select article', description: 'Choose at least one imported article.' });
			return;
		}

		setGenerating(true);
		try {
			const generatedRecords = [];
			const activeAccount = accounts.find((account) => account.id === selectedAccountId);
			const activeBoard = boards.find((board) => board.boardId === selectedBoardId);
			const templateConfig = selectedTemplate?.configuration || createDefaultTemplateConfig();
			for (const article of targets) {
				const generatedPins = await generatePinsForArticle(article, panel.count);
				generatedRecords.push(
					...generatedPins.map((pin, index) => ({
						tempId: `${article.id}-${Date.now()}-${index}`,
						articleId: article.id,
						websiteId: article.websiteId,
						title: String(pin.title || article.title || article.slug || 'Draft AI Pin').trim(),
						description: String(pin.description || '').trim(),
						overlayText: String(pin.overlayText || '').trim(),
						imagePrompt: String(pin.imagePrompt || '').trim(),
						imageUrl: panel.imageMode === 'use_featured' ? (article.featuredImage || '') : '',
						suggestedKeywords: safeArray(pin.suggestedKeywords),
						suggestedHashtags: safeArray(pin.suggestedHashtags),
						accountId: selectedAccountId,
						accountLabel: activeAccount?.label || activeAccount?.accountName || activeAccount?.username || '',
						boardId: selectedBoardId,
						boardName: activeBoard?.name || '',
						templateId: selectedTemplate?.id || '',
						templateName: selectedTemplate?.name || 'Default Template',
						templateConfig,
						category: article.category,
						website: websites.find((site) => site.id === article.websiteId)?.name || '',
						author: article.author,
						featuredImage: article.featuredImage || '',
						imageSource: panel.imageMode === 'use_featured' ? 'featured' : 'ai_generated',
						imageGenerationStatus: panel.imageMode === 'use_featured' ? 'completed' : 'queued',
						imageGenerationError: '',
						imageJobId: '',
					}))
				);
			}

			setGeneratedPreviewPins(generatedRecords);
			await startPreviewImageGeneration(generatedRecords);
			toast({ title: 'Preview ready', description: `${generatedRecords.length} pins generated. Review template preview and save when ready.` });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Generation failed', description: error.message });
		} finally {
			setGenerating(false);
		}
	};

	const regeneratePreviewImage = async (pin) => {
		try {
			setGeneratingImages(true);
			const response = await apiServerClient.fetch(`/ai-pin-images/jobs/${encodeURIComponent(pin.imageJobId || '')}/regenerate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientToken: pin.tempId }),
			});
			const job = await response.json().catch(() => ({}));
			if (!response.ok || !job?.id) {
				throw new Error(job?.message || 'Failed to regenerate image');
			}

			setGeneratedPreviewPins((prev) => prev.map((item) => item.tempId === pin.tempId
				? { ...item, imageJobId: job.id, imageGenerationStatus: 'queued', imageGenerationError: '' }
				: item));
			await pollPreviewImageJobs([job.id]);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Image regenerate failed', description: error.message });
		} finally {
			setGeneratingImages(false);
		}
	};

	const downloadImage = (imageUrl, title) => {
		if (!imageUrl) {
			return;
		}
		const link = document.createElement('a');
		link.href = imageUrl;
		link.download = `${String(title || 'pin-image').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	};

	const saveGeneratedPreviewPins = async () => {
		if (generatedPreviewPins.length === 0) {
			return;
		}

		setSavingGenerated(true);
		try {
			const created = await createPinRecords({ previewPins: generatedPreviewPins });
			setSavedPins((prev) => [...created, ...prev]);
			setGeneratedPreviewPins([]);
			toast({ title: 'Pins saved', description: `${created.length} pins saved as drafts.` });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Save failed', description: error.message });
		} finally {
			setSavingGenerated(false);
		}
	};

	const updateGeneratedPreviewField = (tempId, key, value) => {
		setGeneratedPreviewPins((prev) => prev.map((pin) => (pin.tempId === tempId ? { ...pin, [key]: value } : pin)));
	};

	const toggleDraftPinSelection = (pinId) => {
		setSelectedDraftPinIds((prev) => {
			const next = new Set(prev);
			if (next.has(pinId)) {
				next.delete(pinId);
			} else {
				next.add(pinId);
			}
			return next;
		});
	};

	const selectAllDraftPins = () => {
		setSelectedDraftPinIds(new Set(draftPins.map((pin) => pin.id)));
	};

	const clearDraftPinSelection = () => {
		setSelectedDraftPinIds(new Set());
	};

	const runPublishAction = async (type) => {
		if (!selectedAccountId) {
			toast({ variant: 'destructive', title: 'Select account', description: 'Choose a target Pinterest account first.' });
			return;
		}

		if (!selectedBoardId) {
			toast({ variant: 'destructive', title: 'Select board', description: 'Choose a target Pinterest board.' });
			return;
		}

		if (selectedDraftPins.length === 0) {
			toast({ variant: 'destructive', title: 'Select pins', description: 'Choose one or more draft pins first.' });
			return;
		}

		if (type === 'schedule' && !scheduleAt) {
			toast({ variant: 'destructive', title: 'Schedule time required', description: 'Pick a date and time for scheduling.' });
			return;
		}

		setPublishing(true);
		try {
			const endpoint = type === 'publish' ? '/pinterest/publish' : '/pinterest/schedule';
			const perPinTargets = {};
			for (const pin of selectedDraftPins) {
				if (pin.accountId || pin.boardId) {
					perPinTargets[pin.id] = {
						accountId: pin.accountId || selectedAccountId,
						boardId: pin.boardId || selectedBoardId,
					};
				}
			}

			const payload = {
				pinIds: selectedDraftPins.map((pin) => pin.id),
				accountId: selectedAccountId,
				boardId: selectedBoardId,
				timezone,
				...(Object.keys(perPinTargets).length > 0 ? { perPinTargets } : {}),
				...(type === 'schedule' ? { scheduledAt: new Date(scheduleAt).toISOString() } : {}),
			};

			const response = await apiServerClient.fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(body?.message || `Action failed (${response.status})`);
			}

			await loadPins();
			clearDraftPinSelection();
			if (type === 'publish') {
				toast({ title: 'Publish queued', description: 'Selected pins were added to publishing queue.' });
			} else {
				toast({ title: 'Schedule created', description: 'Selected pins were scheduled successfully.' });
			}
		} catch (error) {
			toast({ variant: 'destructive', title: type === 'publish' ? 'Publish failed' : 'Schedule failed', description: error.message });
		} finally {
			setPublishing(false);
		}
	};

	const handleDeletePin = async (pinId) => {
		try {
			await pb.collection('ai_pins').delete(pinId);
			setSavedPins((prev) => prev.filter((pin) => pin.id !== pinId));
			if (editingPinId === pinId) {
				setEditingPinId('');
			}
			toast({ title: 'Deleted', description: 'Pin removed from draft gallery.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		}
	};

	const handleSaveEdit = async (pin) => {
		try {
			const selectedAccount = accounts.find((account) => account.id === pin.accountId);
			const candidateBoards = boardsByAccount[pin.accountId] || boards;
			const selectedBoard = candidateBoards.find((board) => board.boardId === pin.boardId);

			const updated = await pb.collection('ai_pins').update(pin.id, {
				title: pin.title,
				description: pin.description,
				overlay_text: pin.overlayText,
				image_prompt: pin.imagePrompt,
				image_url: pin.imageUrl,
				pinterest_account_id: pin.accountId || '',
				pinterest_account_label: pin.accountId ? (selectedAccount?.label || selectedAccount?.accountName || selectedAccount?.username || '') : '',
				pinterest_board_id: pin.boardId || '',
				pinterest_board_name: selectedBoard?.name || pin.boardName || '',
				suggested_keywords: safeArray(pin.suggestedKeywords),
				suggested_hashtags: safeArray(pin.suggestedHashtags),
			});
			setSavedPins((prev) => prev.map((item) => (item.id === pin.id ? mapSavedPin(updated) : item)));
			setEditingPinId('');
			toast({ title: 'Saved', description: 'Pin draft updated.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		}
	};

	const handleRegeneratePin = async (pin) => {
		const article = articles.find((item) => item.id === pin.articleId) || activeArticle;
		if (!article) {
			toast({ variant: 'destructive', title: 'Article not found', description: 'Unable to regenerate this pin.' });
			return;
		}

		setGenerating(true);
		try {
			const [regenerated] = await generatePinsForArticle(article, 1);
			const updated = await pb.collection('ai_pins').update(pin.id, {
				title: regenerated.title || pin.title,
				description: regenerated.description || pin.description,
				overlay_text: regenerated.overlayText || pin.overlayText,
				image_prompt: regenerated.imagePrompt || pin.imagePrompt,
				image_url: pin.imageUrl || '',
				suggested_keywords: safeArray(regenerated.suggestedKeywords),
				suggested_hashtags: safeArray(regenerated.suggestedHashtags),
				target_audience: panel.targetAudience,
				tone_of_voice: panel.toneOfVoice,
				language: panel.language,
			});
			setSavedPins((prev) => prev.map((item) => (item.id === pin.id ? mapSavedPin(updated) : item)));
			toast({ title: 'Regenerated', description: 'Pin draft regenerated with AI.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setGenerating(false);
		}
	};

	const updatePinField = (pinId, key, value) => {
		setSavedPins((prev) => prev.map((pin) => (pin.id === pinId ? { ...pin, [key]: value } : pin)));
	};

	const setPinTargetAccount = async (pinId, accountId) => {
		let accountBoards = boardsByAccount[accountId] || [];
		if (accountId && accountBoards.length === 0) {
			try {
				const response = await apiServerClient.fetch(`/pinterest/boards?accountId=${encodeURIComponent(accountId)}`, { method: 'GET' });
				const payload = await response.json().catch(() => []);
				if (response.ok) {
					accountBoards = Array.isArray(payload) ? payload : [];
					setBoardsByAccount((prev) => ({ ...prev, [accountId]: accountBoards }));
				}
			} catch {
				// ignore
			}
		}

		const fallbackBoardId = accountBoards[0]?.boardId || '';
		setSavedPins((prev) => prev.map((pin) => {
			if (pin.id !== pinId) {
				return pin;
			}
			return {
				...pin,
				accountId,
				boardId: fallbackBoardId,
			};
		}));
	};

	return (
		<div>
			<PageHeader
				title="AI Pins"
				subtitle="Select website or manual articles, then generate, preview, and store Pinterest pin drafts."
				action={<div className="flex gap-2"><Link to="/app/ai-pins/templates"><Button variant="outline">Templates</Button></Link><Button onClick={handleGenerate} disabled={generating || loadingArticles || loadingPins}><Wand2 size={16} /> {generating ? 'Generating...' : 'Generate Pins'}</Button></div>}
			/>

			<div className="grid gap-4 lg:grid-cols-3">
				<Card className="lg:col-span-2">
					<ArticlePicker
						websites={websites}
						websiteId={websiteId}
						onWebsiteChange={setWebsiteId}
						articles={articles}
						loading={loadingWebsites || loadingArticles}
						search={articleSearch}
						onSearchChange={setArticleSearch}
						status={articleStatus}
						onStatusChange={(value) => { setArticleStatus(value); setArticlePage(1); }}
						category={articleCategory}
						onCategoryChange={(value) => { setArticleCategory(value); setArticlePage(1); }}
						categories={articleCategories}
						page={articlePage}
						totalPages={articleTotalPages}
						onPageChange={setArticlePage}
						selectedIds={selectedArticleIds}
						activeId={activeArticleId}
						onToggleSelect={toggleArticleSelection}
						onSelectActive={setActiveArticleId}
						onPreview={setPreviewArticle}
						onOpenManual={() => setManualOpen(true)}
					/>
				</Card>

				<Card>
					<h3 className="font-semibold">Generation Panel</h3>
					<p className="mt-1 text-xs text-muted-foreground">Select one article or multiple articles, then generate pin drafts.</p>
					<div className="mt-4 space-y-3">
						<Select label="Template" value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} disabled={loadingTemplates || templates.length === 0}>
							<option value="">System default template</option>
							{templates.map((template) => (
								<option key={template.id} value={template.id}>{template.name}{template.isDefault ? ' (Default)' : ''}</option>
							))}
						</Select>
						<Input label="Pin Title" value={panel.pinTitle} onChange={(e) => setPanel((prev) => ({ ...prev, pinTitle: e.target.value }))} />
						<Textarea label="Pin Description" rows={3} value={panel.pinDescription} onChange={(e) => setPanel((prev) => ({ ...prev, pinDescription: e.target.value }))} />
						<Input label="Text Overlay" value={panel.textOverlay} onChange={(e) => setPanel((prev) => ({ ...prev, textOverlay: e.target.value }))} />
						<Input label="Target Audience" value={panel.targetAudience} onChange={(e) => setPanel((prev) => ({ ...prev, targetAudience: e.target.value }))} />
						<Input label="Tone of Voice" value={panel.toneOfVoice} onChange={(e) => setPanel((prev) => ({ ...prev, toneOfVoice: e.target.value }))} />
						<Input label="Language" value={panel.language} onChange={(e) => setPanel((prev) => ({ ...prev, language: e.target.value }))} />
						<Select label="Image Source" value={panel.imageMode} onChange={(e) => setPanel((prev) => ({ ...prev, imageMode: e.target.value }))}>
							<option value="use_featured">Use Featured Image</option>
							<option value="generate_ai">Generate AI Image</option>
						</Select>
						<Select label="Generate" value={String(panel.count)} onChange={(e) => setPanel((prev) => ({ ...prev, count: Number(e.target.value) }))}>
							{PIN_COUNTS.map((count) => <option key={count} value={count}>Generate {count} Pin{count > 1 ? 's' : ''}</option>)}
						</Select>
						<div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
							<div className="flex items-center gap-1"><Search size={12} /> Selected for bulk: {selectedArticleIds.size}</div>
							<div className="mt-1">Fallback target: {activeArticle ? activeArticle.title : 'No article selected'}</div>
						</div>
					</div>
				</Card>
			</div>

			<div className="mt-6">
				<div className="mb-3 flex items-center justify-between">
					<h3 className="font-semibold">Generated Pins Preview</h3>
					{loadingPins ? <Spinner className="h-4 w-4 text-primary" /> : <span className="text-sm text-muted-foreground">{savedPins.length} Draft Pins</span>}
				</div>

				{generatedPreviewPins.length > 0 ? (
					<Card className="mb-4">
						<div className="mb-3 flex items-center justify-between">
							<p className="font-semibold">Final Pin Preview (Before Save)</p>
							<div className="flex gap-2">
								{generatingImages ? <div className="flex items-center text-xs text-muted-foreground"><Spinner className="mr-1 h-4 w-4" /> Generating images...</div> : null}
								<Button variant="outline" onClick={() => setGeneratedPreviewPins([])}>Discard</Button>
								<Button onClick={saveGeneratedPreviewPins} disabled={savingGenerated}>{savingGenerated ? <Spinner className="h-4 w-4" /> : null} Save Generated Pins</Button>
							</div>
						</div>
						<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
							{generatedPreviewPins.map((pin) => (
								<Card key={pin.tempId}>
									<TemplatePreviewCard
										config={pin.templateConfig}
										context={{
											title: pin.title,
											description: pin.description,
											category: pin.category,
											website: pin.website,
											author: pin.author,
											overlayText: pin.overlayText,
										}}
									/>
									<div className="mt-3 space-y-2">
										<p className="text-xs text-muted-foreground">Template: {pin.templateName}</p>
										<p className="text-xs text-muted-foreground">Image mode: {panel.imageMode === 'generate_ai' ? 'Generate AI Image' : 'Use Featured Image'}</p>
										<p className="text-xs text-muted-foreground">Image status: {pin.imageGenerationStatus || 'idle'}</p>
										{pin.imageGenerationError ? <p className="text-xs text-amber-700">{pin.imageGenerationError}</p> : null}
										<div className="grid gap-2 md:grid-cols-2">
											<div className="rounded-lg border border-border bg-secondary/20 p-2">
												<p className="mb-1 text-[11px] text-muted-foreground">Generated / Selected Image</p>
												{pin.imageUrl ? <img src={pin.imageUrl} alt={pin.title} className="h-40 w-full rounded-md object-cover" loading="lazy" decoding="async" /> : <div className="flex h-40 items-center justify-center text-xs text-muted-foreground"><ImageIcon size={14} className="mr-1" /> Waiting image...</div>}
											</div>
											<div className="rounded-lg border border-border bg-secondary/20 p-2">
												<p className="mb-1 text-[11px] text-muted-foreground">Original Article Featured Image</p>
												{pin.featuredImage ? <img src={pin.featuredImage} alt="Featured" className="h-40 w-full rounded-md object-cover" loading="lazy" decoding="async" /> : <div className="flex h-40 items-center justify-center text-xs text-muted-foreground"><Images size={14} className="mr-1" /> No featured image</div>}
											</div>
										</div>
										<Input label="Image URL (optional now, required before publish)" value={pin.imageUrl} onChange={(e) => updateGeneratedPreviewField(pin.tempId, 'imageUrl', e.target.value)} />
										<div className="flex gap-2">
											<Button size="sm" variant="outline" onClick={() => regeneratePreviewImage(pin)} disabled={panel.imageMode !== 'generate_ai' || generatingImages}><RefreshCw size={14} /> Regenerate</Button>
											<Button size="sm" variant="outline" onClick={() => downloadImage(pin.imageUrl, pin.title)} disabled={!pin.imageUrl}><Download size={14} /> Download</Button>
										</div>
									</div>
								</Card>
							))}
						</div>
					</Card>
				) : null}

				<Card className="mb-4">
					<div className="grid gap-3 md:grid-cols-4">
						<Select label="Pinterest Account" value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)} disabled={loadingAccounts || accounts.length === 0}>
							<option value="">Select account</option>
							{accounts.map((account) => (
								<option key={account.id} value={account.id}>{account.label || account.accountName || account.username}</option>
							))}
						</Select>
						<Select label="Target Board" value={selectedBoardId} onChange={(e) => setSelectedBoardId(e.target.value)} disabled={loadingBoards || boards.length === 0}>
							<option value="">Select board</option>
							{boards.map((board) => (
								<option key={board.id} value={board.boardId}>{board.name}</option>
							))}
						</Select>
						<Input label="Schedule Date & Time" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
						<Input label="Timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
						<div className="flex items-end gap-2 md:col-span-1">
							<Button className="flex-1" onClick={() => runPublishAction('publish')} disabled={publishing || selectedDraftPins.length === 0 || boards.length === 0}><Send size={15} /> Publish now</Button>
							<Button variant="outline" className="flex-1" onClick={() => runPublishAction('schedule')} disabled={publishing || selectedDraftPins.length === 0 || boards.length === 0}><CalendarClock size={15} /> Schedule</Button>
						</div>
					</div>
					<div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
						<div>Selected pins: {selectedDraftPins.length}</div>
						<div className="flex gap-2">
							<Button size="sm" variant="outline" onClick={selectAllDraftPins}><CheckSquare size={14} /> Select all</Button>
							<Button size="sm" variant="outline" onClick={clearDraftPinSelection}><Square size={14} /> Clear</Button>
						</div>
					</div>
				</Card>

				{savedPins.length === 0 ? (
					<Empty icon={Sparkles} title="No generated pins yet" subtitle="Generate pins from imported articles and they will appear here as drafts." />
				) : (
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						{savedPins.map((pin) => {
							const editing = editingPinId === pin.id;
							const checked = selectedDraftPinIds.has(pin.id);
							return (
								<Card key={pin.id}>
									<div className="mb-2 flex items-center justify-between">
										<label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
											<input type="checkbox" checked={checked} onChange={() => toggleDraftPinSelection(pin.id)} disabled={pin.status === 'published'} />
											Select
										</label>
										<Badge tone={pin.status === 'published' ? 'green' : pin.status === 'failed' ? 'red' : pin.status === 'scheduled' ? 'amber' : 'blue'}>{pin.status}</Badge>
									</div>
									<div className="rounded-xl border border-dashed border-border bg-secondary/30 p-3">
										<div className="flex h-40 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 via-accent/20 to-secondary text-center">
											<div>
												<Globe className="mx-auto h-6 w-6 text-muted-foreground" />
												<p className="mt-2 text-xs text-muted-foreground">{pin.imageUrl ? 'Image URL attached' : 'Image URL required for publishing'}</p>
											</div>
										</div>
									</div>

									<div className="mt-3 space-y-2">
										{editing ? (
											<>
												<Input label="Pin Title" value={pin.title} onChange={(e) => updatePinField(pin.id, 'title', e.target.value)} />
												<Textarea label="Description" rows={3} value={pin.description} onChange={(e) => updatePinField(pin.id, 'description', e.target.value)} />
												<Input label="Overlay Text" value={pin.overlayText} onChange={(e) => updatePinField(pin.id, 'overlayText', e.target.value)} />
												<Textarea label="Image Prompt" rows={3} value={pin.imagePrompt} onChange={(e) => updatePinField(pin.id, 'imagePrompt', e.target.value)} />
												<Input label="Image URL (required to publish)" value={pin.imageUrl} onChange={(e) => updatePinField(pin.id, 'imageUrl', e.target.value)} placeholder="https://..." />
												<Input label="Suggested Keywords" value={safeArray(pin.suggestedKeywords).join(', ')} onChange={(e) => updatePinField(pin.id, 'suggestedKeywords', safeArray(e.target.value))} />
												<Input label="Suggested Hashtags" value={safeArray(pin.suggestedHashtags).join(', ')} onChange={(e) => updatePinField(pin.id, 'suggestedHashtags', safeArray(e.target.value))} />
												<Select label="Target Account (for bulk publish/schedule)" value={pin.accountId || ''} onChange={(e) => setPinTargetAccount(pin.id, e.target.value)}>
													<option value="">Use global account</option>
													{accounts.map((account) => (
														<option key={account.id} value={account.id}>{account.label || account.accountName || account.username}</option>
													))}
												</Select>
												<Select label="Target Board (for bulk publish/schedule)" value={pin.boardId || ''} onChange={(e) => updatePinField(pin.id, 'boardId', e.target.value)}>
													<option value="">Use global board</option>
													{(boardsByAccount[pin.accountId || selectedAccountId] || boards).map((board) => (
														<option key={board.id} value={board.boardId}>{board.name}</option>
													))}
												</Select>
											</>
										) : (
											<>
												<h4 className="line-clamp-2 font-semibold">{pin.title}</h4>
												<p className="line-clamp-3 text-sm text-muted-foreground">{pin.description}</p>
												<p className="text-xs"><span className="font-medium">Overlay:</span> {pin.overlayText || '—'}</p>
												<p className="text-xs"><span className="font-medium">Image URL:</span> {pin.imageUrl || '—'}</p>
												<p className="text-xs"><span className="font-medium">Target Account:</span> {accounts.find((account) => account.id === pin.accountId)?.label || accounts.find((account) => account.id === pin.accountId)?.username || 'Global account'}</p>
												<p className="text-xs"><span className="font-medium">Target Board:</span> {pin.boardName || pin.boardId || 'Global board'}</p>
												<p className="line-clamp-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">Prompt:</span> {pin.imagePrompt || '—'}</p>
												<p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Keywords:</span> {safeArray(pin.suggestedKeywords).join(', ') || '—'}</p>
												<p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Hashtags:</span> {safeArray(pin.suggestedHashtags).join(' ') || '—'}</p>
												{pin.scheduledAt ? <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Scheduled:</span> {new Date(pin.scheduledAt).toLocaleString()} ({pin.scheduledTimezone || 'UTC'})</p> : null}
												{pin.pinterestPinUrl ? <a href={pin.pinterestPinUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Open Pinterest pin</a> : null}
												{pin.publishError ? <p className="text-xs text-red-600">Error: {pin.publishError}</p> : null}
											</>
										)}

										<div className="mt-3 flex items-center justify-between gap-2">
											<div className="flex gap-2">
												{editing ? (
													<>
														<Button size="sm" onClick={() => handleSaveEdit(pin)}>Save</Button>
														<Button size="sm" variant="outline" onClick={() => setEditingPinId('')}>Cancel</Button>
													</>
												) : (
													<>
														<Button size="sm" variant="outline" onClick={() => setEditingPinId(pin.id)}><Pencil size={14} /> Edit</Button>
														<Button size="sm" variant="outline" onClick={() => handleRegeneratePin(pin)} disabled={generating}><RefreshCw size={14} /> Regenerate</Button>
														<Button size="sm" variant="ghost" onClick={() => handleDeletePin(pin.id)}><Trash2 size={14} /></Button>
													</>
												)}
											</div>
										</div>
									</div>
								</Card>
							);
						})}
					</div>
				)}
			</div>

			<ArticlePreviewDrawer
				article={previewArticle}
				open={Boolean(previewArticle)}
				onClose={() => setPreviewArticle(null)}
			/>
			<ManualArticleForm
				open={manualOpen}
				onClose={() => setManualOpen(false)}
				onSubmit={saveManualArticle}
				saving={savingManual}
			/>
		</div>
	);
}
