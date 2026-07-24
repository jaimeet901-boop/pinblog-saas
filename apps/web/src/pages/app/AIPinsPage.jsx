import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
	Wand2, Sparkles, RefreshCw, Trash2, Pencil, Search, Globe, Send, CalendarClock,
	CheckSquare, Square, Download, Image as ImageIcon, Images, Layers, Shuffle,
	ChevronDown, History, LayoutTemplate, Palette, X, FileStack, PenLine, ListChecks,
	Eye, Copy, ListPlus, Library,
} from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import apiServerClient from '@/lib/apiServerClient';
import { generateText, extractJson } from '@/lib/aiGenerate';
import { Badge, Button, Card, Empty, Input, Select, Spinner, Textarea } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import TemplatePreviewCard from '@/components/ai-pins/TemplatePreviewCard';
import ArticlePreviewDrawer from '@/components/ai-pins/ArticlePreviewDrawer';
import ManualArticleForm from '@/components/ai-pins/ManualArticleForm';
import SchedulePinModal from '@/components/ai-pins/SchedulePinModal';
import PreviewPinModal from '@/components/ai-pins/PreviewPinModal';
import PublishProgressModal from '@/components/ai-pins/PublishProgressModal';
import { createDefaultTemplateConfig } from '@/lib/pinTemplates';
import { useWorkspaceConfig } from '@/context/WorkspaceConfigContext';
import {
	PIN_ASPECT_RATIOS,
	buildImageQualityOptions,
	buildPinCountOptions,
	buildPinPromptFromConfig,
	estimatePinCredits,
	languageLabelFromConfig,
	mapStudioBrandKits,
	mapStudioCredits,
	mapStudioPinStyles,
	mapStudioTemplates,
	resolveDefaultAspectRatioId,
	resolveDefaultImageProvider,
	resolveDefaultImageQualityId,
	resolvePublishingConfig,
} from '@/lib/aiPinsWorkspaceConfig';
import {
	mapSavedPin,
	saveDrafts,
	duplicatePin,
	updateDraftPin,
	deleteDraftPin,
	runPublishNowFlow,
	expandRecurrence,
	schedulePins,
	scheduleRecurrenceSeries,
	addPinsToQueue,
	buildPinPreview,
	openDesignLibraryChooser,
} from '@/services/ai-pins';
import './AIPinsPage.css';

const CREATE_MODES = [
	{ id: 'single', label: 'Single Page', icon: FileStack },
	{ id: 'bulk', label: 'Bulk Create', icon: Layers },
	{ id: 'prompt', label: 'Prompt Only', icon: PenLine },
];

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

export default function AIPinsPage() {
	const { toast } = useToast();
	const navigate = useNavigate();
	const {
		config,
		configVersion,
		isRefreshing: configRefreshing,
		hasValidConfig,
		lastConfigUpdate,
		lastRefreshDurationMs,
		cacheStatus,
		refresh: refreshWorkspaceConfig,
		isFeatureEnabled,
	} = useWorkspaceConfig();

	const previousStatusesRef = useRef(new Map());
	const defaultsAppliedRef = useRef(false);
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
	const [timezone, setTimezone] = useState(
		() => config?.schedulingDefaults?.timezone || config?.general?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
	);
	const [panel, setPanel] = useState({
		pinTitle: '',
		pinDescription: '',
		textOverlay: '',
		targetAudience: '',
		toneOfVoice: '',
		language: languageLabelFromConfig(config),
		count: 3,
		imageMode: 'use_featured',
		style: '',
		imageProvider: resolveDefaultImageProvider(config),
	});
	const [analysis, setAnalysis] = useState(null);
	const [analyzing, setAnalyzing] = useState(false);
	const [bulkProgress, setBulkProgress] = useState({ active: false, current: 0, total: 0, message: '' });
	const [selectedBrandKitId, setSelectedBrandKitId] = useState('');
	const [createMode, setCreateMode] = useState('single');
	const [workspaceTab, setWorkspaceTab] = useState('studio');
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [includeWebsiteUrl, setIncludeWebsiteUrl] = useState(true);
	const [imageQuality, setImageQuality] = useState(() => resolveDefaultImageQualityId(config));
	const [aspectRatio, setAspectRatio] = useState(() => resolveDefaultAspectRatioId(config));
	const [imageType, setImageType] = useState('pin');
	const [promptOnlyText, setPromptOnlyText] = useState('');
	const [referenceImages, setReferenceImages] = useState([]);
	const [selectedPreviewTempId, setSelectedPreviewTempId] = useState('');
	const [pinFilter, setPinFilter] = useState('all');
	const [pinSearch, setPinSearch] = useState('');
	const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
	const [previewModal, setPreviewModal] = useState(null);
	const [publishProgressOpen, setPublishProgressOpen] = useState(false);
	const [publishProgress, setPublishProgress] = useState(null);
	const [publishResult, setPublishResult] = useState(null);
	const [scheduling, setScheduling] = useState(false);
	const [queueing, setQueueing] = useState(false);
	const [actionPinIds, setActionPinIds] = useState([]);
	const referenceInputRef = useRef(null);
	const publishAbortRef = useRef(null);

	const platformName = config?.general?.platformName || 'Chef IA';
	const publishingConfig = useMemo(() => resolvePublishingConfig(config), [config]);
	const templates = useMemo(() => mapStudioTemplates(config), [config]);
	const brandKits = useMemo(() => mapStudioBrandKits(config), [config]);
	const pinStyles = useMemo(() => mapStudioPinStyles(config), [config]);
	const credits = useMemo(() => mapStudioCredits(config), [config]);
	const imageQualities = useMemo(() => buildImageQualityOptions(config), [config]);
	const pinCounts = useMemo(() => buildPinCountOptions(config), [config]);
	const imageProviders = useMemo(
		() => (Array.isArray(config?.imageProviders) ? config.imageProviders.filter((item) => item?.enabled !== false) : []),
		[config],
	);

	const showBrandKit = isFeatureEnabled('brand-kit', true);
	const showTemplates = isFeatureEnabled('templates', true);
	const showHistory = isFeatureEnabled('history', true);
	const showAiImages = isFeatureEnabled('ai-images', true);
	const showPinterest = isFeatureEnabled('pinterest', true);

	useEffect(() => {
		if (!hasValidConfig || defaultsAppliedRef.current) return;
		defaultsAppliedRef.current = true;

		const defaultProvider = resolveDefaultImageProvider(config);
		const defaultQualityId = resolveDefaultImageQualityId(config);
		const defaultQuality = imageQualities.find((item) => item.id === defaultQualityId) || imageQualities[0];
		const styles = mapStudioPinStyles(config);
		const recipeStyle = String(config?.content?.recipeStyle || '').trim();
		const defaultTone = String(config?.content?.defaultPinTone || recipeStyle || '').trim();
		const defaultAudience = String(config?.content?.defaultPinAudience || '').trim();

		setTimezone((prev) => prev || config?.schedulingDefaults?.timezone || config?.general?.timezone || 'UTC');
		setAspectRatio(resolveDefaultAspectRatioId(config));
		setImageQuality(defaultQualityId);
		setPanel((prev) => ({
			...prev,
			language: prev.language || languageLabelFromConfig(config),
			toneOfVoice: prev.toneOfVoice || defaultTone,
			targetAudience: prev.targetAudience || defaultAudience,
			style: prev.style || styles[0] || '',
			imageProvider: defaultQuality?.imageProvider || defaultProvider || prev.imageProvider,
			imageMode: defaultQuality?.imageMode || prev.imageMode,
			count: pinCounts.includes(prev.count) ? prev.count : (pinCounts[1] || pinCounts[0] || 1),
		}));

		const defaultTemplate = templates.find((item) => item.isDefault) || templates[0];
		if (defaultTemplate) setSelectedTemplateId((prev) => prev || defaultTemplate.id);
		const defaultKit = brandKits.find((item) => item.isDefault) || brandKits[0];
		if (defaultKit) setSelectedBrandKitId((prev) => prev || defaultKit.id);
	}, [hasValidConfig, config, imageQualities, pinCounts, templates, brandKits]);

	useEffect(() => {
		// Live config: keep selection valid when Admin removes providers/templates/kits.
		if (imageQualities.length > 0 && !imageQualities.some((item) => item.id === imageQuality)) {
			const next = resolveDefaultImageQualityId(config, imageQualities);
			setImageQuality(next);
			const quality = imageQualities.find((item) => item.id === next);
			if (quality) {
				setPanel((prev) => ({
					...prev,
					imageMode: quality.imageMode,
					imageProvider: quality.imageProvider,
				}));
			}
		}
		if (selectedTemplateId && templates.length > 0 && !templates.some((item) => item.id === selectedTemplateId)) {
			const fallback = templates.find((item) => item.isDefault) || templates[0];
			setSelectedTemplateId(fallback?.id || '');
		}
		if (selectedBrandKitId && brandKits.length > 0 && !brandKits.some((item) => item.id === selectedBrandKitId)) {
			const fallback = brandKits.find((item) => item.isDefault) || brandKits[0];
			setSelectedBrandKitId(fallback?.id || '');
		}
		if (panel.style && pinStyles.length > 0 && !pinStyles.includes(panel.style)) {
			setPanel((prev) => ({ ...prev, style: pinStyles[0] || '' }));
		}
	}, [configVersion, imageQualities, imageQuality, templates, selectedTemplateId, brandKits, selectedBrandKitId, pinStyles, panel.style, config]);

	const activeArticle = useMemo(
		() => articles.find((article) => article.id === activeArticleId) || null,
		[articles, activeArticleId],
	);

	const selectedArticles = useMemo(
		() => articles.filter((article) => selectedArticleIds.has(article.id)),
		[articles, selectedArticleIds],
	);

	const draftPins = useMemo(
		() => savedPins.filter((pin) => pin.status === 'draft' || pin.status === 'failed'),
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

	const selectedBrandKit = useMemo(
		() => brandKits.find((kit) => kit.id === selectedBrandKitId) || null,
		[brandKits, selectedBrandKitId],
	);

	const filteredSavedPins = useMemo(() => {
		const query = pinSearch.trim().toLowerCase();
		return savedPins.filter((pin) => {
			if (pinFilter === 'draft' && pin.status !== 'draft') return false;
			if (pinFilter === 'failed' && pin.status !== 'failed') return false;
			if (pinFilter === 'scheduled' && pin.status !== 'scheduled') return false;
			if (pinFilter === 'published' && pin.status !== 'published') return false;
			if (!query) return true;
			return [pin.title, pin.description, pin.imageUrl, pin.boardName]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(query));
		});
	}, [savedPins, pinFilter, pinSearch]);

	const failedPins = useMemo(
		() => savedPins.filter((pin) => pin.status === 'failed'),
		[savedPins],
	);

	const inspectorPin = useMemo(() => {
		if (editingPinId) {
			return savedPins.find((pin) => pin.id === editingPinId) || null;
		}
		if (selectedPreviewTempId) {
			return generatedPreviewPins.find((pin) => pin.tempId === selectedPreviewTempId) || null;
		}
		return null;
	}, [editingPinId, savedPins, selectedPreviewTempId, generatedPreviewPins]);

	const estimatedCredits = useMemo(() => {
		const quality = imageQualities.find((item) => item.id === imageQuality) || imageQualities[0];
		const articleFactor = createMode === 'bulk' ? Math.max(1, selectedArticleIds.size) : 1;
		return estimatePinCredits({
			quality,
			count: panel.count,
			articleFactor,
		});
	}, [imageQuality, imageQualities, panel.count, createMode, selectedArticleIds.size]);

	const activeWebsite = useMemo(
		() => websites.find((site) => site.id === websiteId) || null,
		[websites, websiteId],
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
			const payload = await response.json().catch(() => ([]));
			if (response.status === 401 || response.status === 422) {
				setBoards([]);
				setSelectedBoardId('');
				toast({
					variant: 'destructive',
					title: 'Pinterest account unavailable',
					description: payload?.message || 'Reconnect this Pinterest account to load boards.',
				});
				return;
			}
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to load Pinterest boards (${response.status})`);
			}
			setBoards(Array.isArray(payload) ? payload : []);
			if (Array.isArray(payload) && payload.length > 0) {
				const preferredBoard = payload.find((board) => board.isDefault) || payload[0];
				setSelectedBoardId((prev) => {
					if (prev && payload.some((board) => board.boardId === prev)) {
						return prev;
					}
					return preferredBoard.boardId;
				});
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
				const preferredAccount = items.find((account) => account.isDefault) || items[0];
				setSelectedAccountId((prev) => {
					if (prev && items.some((account) => account.id === prev)) {
						return prev;
					}
					return preferredAccount.id;
				});
			}
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoadingAccounts(false);
		}
	};

	const handleAnalyzeArticle = async () => {
		if (!activeArticle) {
			toast({ variant: 'destructive', title: 'Select an article', description: 'Choose an article to analyze first.' });
			return;
		}
		setAnalyzing(true);
		try {
			const response = await apiServerClient.fetch('/ai-pins/analyze', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ articleId: activeArticle.id, style: panel.style }),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Analysis failed (${response.status})`);
			}
			setAnalysis(payload.analysis || null);
			setPanel((prev) => ({
				...prev,
				pinTitle: payload.analysis?.title || prev.pinTitle,
				pinDescription: payload.analysis?.seoDescription || prev.pinDescription,
				targetAudience: payload.analysis?.targetAudience || prev.targetAudience,
			}));
			await refreshWorkspaceConfig();
			toast({ title: 'Article analyzed', description: 'Pinterest metadata was generated from the article.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Analyze failed', description: error.message });
		} finally {
			setAnalyzing(false);
		}
	};

	const handleGeneratePrompt = async () => {
		if (!activeArticle) {
			toast({ variant: 'destructive', title: 'Select an article', description: 'Choose an article first.' });
			return;
		}
		try {
			const response = await apiServerClient.fetch('/ai-pins/prompts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					articleId: activeArticle.id,
					style: panel.style,
					analysis,
				}),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Prompt generation failed (${response.status})`);
			}
			if (payload.analysis) setAnalysis(payload.analysis);
			setPanel((prev) => ({
				...prev,
				textOverlay: payload.analysis?.cta || prev.textOverlay,
			}));
			await refreshWorkspaceConfig();
			toast({ title: 'Prompt ready', description: 'Image prompt optimized for the selected style.' });
			return payload.imagePrompt || '';
		} catch (error) {
			toast({ variant: 'destructive', title: 'Prompt failed', description: error.message });
			return '';
		}
	};

	useEffect(() => {
		loadWebsites();
		loadAccounts();
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
		if (!hasValidConfig) return;
		const nextTz = publishingConfig.timezone;
		if (nextTz) setTimezone(nextTz);
	}, [hasValidConfig, publishingConfig.timezone, configVersion]);

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

	const createPinRecords = async ({ previewPins }) => saveDrafts({ previewPins, panel });

	const buildPerPinTargets = (pins) => {
		const perPinTargets = {};
		for (const pin of pins) {
			if (pin.accountId || pin.boardId) {
				perPinTargets[pin.id] = {
					accountId: pin.accountId || selectedAccountId,
					boardId: pin.boardId || selectedBoardId,
				};
			}
		}
		return perPinTargets;
	};

	const resolveActionPins = (explicitPins) => {
		if (Array.isArray(explicitPins) && explicitPins.length > 0) return explicitPins;
		if (actionPinIds.length > 0) {
			const fromIds = savedPins.filter((pin) => actionPinIds.includes(pin.id));
			if (fromIds.length) return fromIds;
		}
		return selectedDraftPins;
	};

	const assertPublishTargets = (pins, accountId, boardId) => {
		if (!accountId) throw new Error('Choose a target Pinterest account first.');
		if (!boardId) throw new Error('Choose a target Pinterest board.');
		if (!pins.length) throw new Error('Choose one or more draft pins first.');
		const missingImage = pins.find((pin) => !String(pin.imageUrl || '').trim());
		if (missingImage) throw new Error(`Pin "${missingImage.title || missingImage.id}" needs an image before publishing.`);
	};

	const handleChooseDesignLibraryTemplate = () => {
		const bridge = openDesignLibraryChooser({
			onSelect: (template) => {
				if (template?.id) setSelectedTemplateId(template.id);
			},
		});
		toast({
			title: 'Design Library',
			description: bridge.message,
		});
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
					provider: panel.imageProvider || resolveDefaultImageProvider(config),
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

	const startPreviewImageGeneration = async (pins, imageModeOverride = panel.imageMode) => {
		if (imageModeOverride !== 'generate_ai') {
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

	const generatePinsForArticle = async (article, count, panelOverride = panel) => {
		const prompt = buildPinPromptFromConfig({ config, article, count, panel: panelOverride });
		const { text } = await generateText(prompt);
		let pins = parsePinsFromText(text);

		if (!Array.isArray(pins) || pins.length === 0) {
			pins = Array.from({ length: count }).map((_, index) => ({
				title: `${article.title} | Pinterest Pin ${index + 1}`,
				description: article.metaDescription || `Discover insights from ${article.title}`,
				overlayText: truncate(panelOverride.textOverlay || article.title || article.slug || 'Read now', 48),
				suggestedKeywords: [article.category || 'content strategy', 'pinterest seo', 'blog traffic'],
				suggestedHashtags: ['#pinteresttips', '#blogstrategy', '#contentmarketing'],
				imagePrompt: `Pinterest vertical pin, high-contrast composition, focus on ${article.title}, category ${article.category || 'blog'}, audience ${panelOverride.targetAudience}, tone ${panelOverride.toneOfVoice}, language ${panelOverride.language}`,
			}));
		}

		return pins.slice(0, count);
	};

	const handleGenerate = async () => {
		if (!websiteId) {
			toast({ variant: 'destructive', title: 'Select website', description: 'Please select a website first.' });
			return;
		}

		const quality = imageQualities.find((item) => item.id === imageQuality) || imageQualities[0];
		const ratio = PIN_ASPECT_RATIOS.find((item) => item.id === aspectRatio);
		const websiteLabel = activeWebsite?.domain || activeWebsite?.url || activeWebsite?.name || '';

		let workingPanel = {
			...panel,
			imageMode: quality.imageMode,
			imageProvider: quality.imageProvider,
		};

		if (createMode === 'prompt') {
			const promptSeed = promptOnlyText.trim();
			if (!promptSeed) {
				toast({ variant: 'destructive', title: 'Prompt required', description: 'Describe the pin you want to create.' });
				return;
			}
			workingPanel = {
				...workingPanel,
				pinTitle: workingPanel.pinTitle || truncate(promptSeed, 80),
				pinDescription: workingPanel.pinDescription || promptSeed,
				textOverlay: workingPanel.textOverlay || truncate(promptSeed, 48),
			};
		}

		if (includeWebsiteUrl && websiteLabel) {
			workingPanel = {
				...workingPanel,
				textOverlay: workingPanel.textOverlay
					? `${workingPanel.textOverlay} · ${websiteLabel}`
					: websiteLabel,
			};
		}

		if (ratio) {
			workingPanel = {
				...workingPanel,
				toneOfVoice: `${workingPanel.toneOfVoice} | format:${imageType} | aspect:${ratio.ratio}`,
			};
		}

		setPanel((prev) => ({
			...prev,
			imageMode: workingPanel.imageMode,
			imageProvider: workingPanel.imageProvider,
			pinTitle: workingPanel.pinTitle,
			pinDescription: workingPanel.pinDescription,
			textOverlay: workingPanel.textOverlay,
		}));

		let targets = [];
		if (createMode === 'bulk') {
			targets = selectedArticles;
			if (targets.length === 0) {
				toast({ variant: 'destructive', title: 'Select articles', description: 'Choose one or more articles for bulk create.' });
				return;
			}
		} else if (createMode === 'single') {
			targets = activeArticle ? [activeArticle] : [];
			if (targets.length === 0) {
				toast({ variant: 'destructive', title: 'Select article', description: 'Choose a page/article to generate from.' });
				return;
			}
		} else {
			targets = activeArticle ? [activeArticle] : (selectedArticles[0] ? [selectedArticles[0]] : []);
			if (targets.length === 0) {
				toast({
					variant: 'destructive',
					title: 'Anchor article needed',
					description: 'Prompt Only still saves pins to a website article. Select or add one article as an anchor.',
				});
				return;
			}
		}

		setGenerating(true);
		setWorkspaceTab('studio');
		setBulkProgress({ active: true, current: 0, total: targets.length, message: 'Starting generation...' });
		try {
			const generatedRecords = [];
			const activeAccount = accounts.find((account) => account.id === selectedAccountId);
			const activeBoard = boards.find((board) => board.boardId === selectedBoardId);
			const templateConfig = selectedTemplate?.configuration || createDefaultTemplateConfig();
			const selectedBrand = brandKits.find((item) => item.id === selectedBrandKitId) || null;
			for (let articleIndex = 0; articleIndex < targets.length; articleIndex += 1) {
				const article = targets[articleIndex];
				setBulkProgress({
					active: true,
					current: articleIndex + 1,
					total: targets.length,
					message: `Generating pins for ${article.title || article.slug || 'article'}...`,
				});
				const generatedPins = await generatePinsForArticle(article, workingPanel.count, workingPanel);
				generatedRecords.push(
					...generatedPins.map((pin, index) => ({
						tempId: `${article.id}-${Date.now()}-${index}`,
						articleId: article.id,
						websiteId: article.websiteId,
						title: String(pin.title || analysis?.title || article.title || article.slug || 'Draft AI Pin').trim(),
						description: String(pin.description || analysis?.seoDescription || workingPanel.pinDescription || '').trim(),
						overlayText: String(pin.overlayText || analysis?.cta || workingPanel.textOverlay || '').trim(),
						imagePrompt: String(pin.imagePrompt || '').trim(),
						imageUrl: workingPanel.imageMode === 'use_featured' ? (article.featuredImage || '') : '',
						suggestedKeywords: safeArray(pin.suggestedKeywords?.length ? pin.suggestedKeywords : analysis?.keywords),
						suggestedHashtags: safeArray(pin.suggestedHashtags?.length ? pin.suggestedHashtags : analysis?.hashtags),
						accountId: selectedAccountId,
						accountLabel: activeAccount?.label || activeAccount?.accountName || activeAccount?.username || '',
						boardId: selectedBoardId,
						boardName: activeBoard?.name || '',
						templateId: selectedTemplate?.id || '',
						templateName: selectedTemplate?.name || 'Default Template',
						templateConfig: {
							...templateConfig,
							...(selectedBrand ? {
								colors: {
									primary: selectedBrand.primaryColor,
									secondary: selectedBrand.secondaryColor,
									accent: selectedBrand.accentColor,
								},
								watermark: selectedBrand.watermarkText || selectedBrand.watermarkUrl || '',
								website: selectedBrand.websiteUrl || '',
							} : {}),
						},
						category: article.category || analysis?.pinterestCategory || '',
						website: selectedBrand?.websiteUrl || websites.find((site) => site.id === article.websiteId)?.name || '',
						author: article.author,
						featuredImage: article.featuredImage || '',
						imageSource: workingPanel.imageMode === 'use_featured' ? 'featured' : 'ai_generated',
						imageGenerationStatus: workingPanel.imageMode === 'use_featured' ? 'completed' : 'queued',
						imageGenerationError: '',
						imageJobId: '',
						style: workingPanel.style,
						cta: analysis?.cta || '',
						analysis: analysis || null,
						brandKitId: selectedBrandKitId || '',
					}))
				);
			}

			setGeneratedPreviewPins(generatedRecords);
			setSelectedPreviewTempId(generatedRecords[0]?.tempId || '');
			setEditingPinId('');
			await startPreviewImageGeneration(generatedRecords, workingPanel.imageMode);
			toast({ title: 'Preview ready', description: `${generatedRecords.length} pins generated. Review and save when ready.` });
		} catch (error) {
			const detail = error?.message || (error?.status ? `HTTP ${error.status}` : 'Unknown error');
			toast({ variant: 'destructive', title: 'Generation failed', description: detail });
		} finally {
			setGenerating(false);
			setBulkProgress({ active: false, current: 0, total: 0, message: '' });
			await refreshWorkspaceConfig();
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

	const runPublishNow = async (explicitPins) => {
		const pins = resolveActionPins(explicitPins);
		try {
			assertPublishTargets(pins, selectedAccountId, selectedBoardId);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Cannot publish', description: error.message });
			return;
		}

		publishAbortRef.current?.abort?.();
		const controller = new AbortController();
		publishAbortRef.current = controller;

		setPublishing(true);
		setPublishResult(null);
		setPublishProgress({ phase: 'submitting', jobs: [], elapsedMs: 0, message: 'Submitting…' });
		setPublishProgressOpen(true);

		try {
			const result = await runPublishNowFlow({
				pinIds: pins.map((pin) => pin.id),
				accountId: selectedAccountId,
				boardId: selectedBoardId,
				timezone: publishingConfig.timezone || timezone,
				perPinTargets: buildPerPinTargets(pins),
				pollMs: Math.min(5000, Math.max(1500, publishingConfig.pollHintMs / 3)),
				timeoutMs: 120000,
				signal: controller.signal,
				onProgress: setPublishProgress,
			});
			setPublishResult(result);
			await loadPins();
			clearDraftPinSelection();
			if (result.ok) {
				toast({ title: 'Published', description: result.message });
			} else {
				toast({
					variant: 'destructive',
					title: result.timedOut ? 'Still processing' : 'Publish incomplete',
					description: result.message,
				});
			}
		} catch (error) {
			setPublishProgressOpen(false);
			toast({ variant: 'destructive', title: 'Publish failed', description: error.message });
		} finally {
			setPublishing(false);
		}
	};

	const openScheduleModal = (explicitPins) => {
		const pins = resolveActionPins(explicitPins);
		try {
			assertPublishTargets(pins, selectedAccountId || pins[0]?.accountId, selectedBoardId || pins[0]?.boardId);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Cannot schedule', description: error.message });
			return;
		}
		setActionPinIds(pins.map((pin) => pin.id));
		setScheduleModalOpen(true);
	};

	const handleScheduleSubmit = async (form) => {
		const pins = resolveActionPins();
		if (pins.length === 0) {
			throw new Error('Select draft pins first');
		}

		setScheduling(true);
		try {
			const occurrences = expandRecurrence({
				mode: form.mode,
				startAt: form.scheduledAt,
				endAt: form.endAt,
				customIntervalDays: form.customIntervalDays,
			});

			const perPinTargets = buildPerPinTargets(pins);

			if (occurrences.length === 1) {
				await schedulePins({
					pinIds: pins.map((pin) => pin.id),
					accountId: form.accountId,
					boardId: form.boardId,
					timezone: form.timezone,
					scheduledAt: occurrences[0],
					perPinTargets,
				});
			} else {
				// One active job per pin: duplicate for extra occurrences so Calendar shows each slot.
				const pinIdsByOccurrence = [pins.map((pin) => pin.id)];
				for (let i = 1; i < occurrences.length; i += 1) {
					const copies = [];
					for (const pin of pins) {
						copies.push(await duplicatePin(pin, { titleSuffix: ` (${i + 1}/${occurrences.length})` }));
					}
					pinIdsByOccurrence.push(copies.map((pin) => pin.id));
				}
				await scheduleRecurrenceSeries({
					occurrenceDates: occurrences,
					pinIdsByOccurrence,
					accountId: form.accountId,
					boardId: form.boardId,
					timezone: form.timezone,
					perPinTargets,
				});
			}

			setSelectedAccountId(form.accountId);
			setSelectedBoardId(form.boardId);
			setTimezone(form.timezone);
			setScheduleModalOpen(false);
			setActionPinIds([]);
			await loadPins();
			clearDraftPinSelection();
			toast({
				title: 'Scheduled',
				description: `${pins.length} pin(s) · ${occurrences.length} occurrence(s) — visible on Calendar.`,
			});
		} finally {
			setScheduling(false);
		}
	};

	const handleAddToQueue = async (explicitPins) => {
		const pins = resolveActionPins(explicitPins);
		try {
			assertPublishTargets(pins, selectedAccountId, selectedBoardId);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Cannot queue', description: error.message });
			return;
		}

		setQueueing(true);
		try {
			const result = await addPinsToQueue({
				config,
				pinIds: pins.map((pin) => pin.id),
				accountId: selectedAccountId,
				boardId: selectedBoardId,
				perPinTargets: buildPerPinTargets(pins),
			});
			await loadPins();
			clearDraftPinSelection();
			const first = result.slots?.[0];
			toast({
				title: 'Added to queue',
				description: first
					? `${result.message}. Next slot: ${first.localLabel}`
					: result.message,
			});
		} catch (error) {
			toast({ variant: 'destructive', title: 'Queue failed', description: error.message });
		} finally {
			setQueueing(false);
		}
	};

	const handlePreviewPin = (pin) => {
		const account = accounts.find((item) => item.id === (pin.accountId || selectedAccountId));
		const boardList = boardsByAccount[pin.accountId || selectedAccountId] || boards;
		const board = boardList.find((item) => item.boardId === (pin.boardId || selectedBoardId));
		const article = articles.find((item) => item.id === pin.articleId);
		const website = websites.find((item) => item.id === (pin.websiteId || websiteId));
		const preview = buildPinPreview({
			pin: {
				...pin,
				accountId: pin.accountId || selectedAccountId,
				boardId: pin.boardId || selectedBoardId,
			},
			account,
			board,
			article,
			websiteUrl: article?.url || website?.domain || website?.url || '',
		});
		setPreviewModal(preview);
	};

	const handleDuplicatePin = async (pin) => {
		try {
			const copy = await duplicatePin(pin);
			setSavedPins((prev) => [copy, ...prev]);
			setWorkspaceTab('library');
			toast({ title: 'Duplicated', description: 'A draft copy was created.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Duplicate failed', description: error.message });
		}
	};

	const handleDeletePin = async (pinId) => {
		try {
			await deleteDraftPin(pinId);
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
			const candidateBoards = boardsByAccount[pin.accountId] || boards;
			const next = await updateDraftPin({
				pin,
				accounts,
				boards: candidateBoards,
				analysis,
				panel,
			});
			setSavedPins((prev) => prev.map((item) => (item.id === pin.id ? { ...item, ...next } : item)));
			setEditingPinId('');
			toast({ title: 'Saved', description: 'Pin editor changes saved.' });
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

		const preferredBoard = accountBoards.find((board) => board.isDefault) || accountBoards[0];
		const fallbackBoardId = preferredBoard?.boardId || '';
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

	const selectAllArticles = () => {
		setSelectedArticleIds(new Set(articles.map((article) => article.id)));
	};

	const clearArticleSelection = () => {
		setSelectedArticleIds(new Set());
	};

	const selectRandomArticles = (count = 1) => {
		if (articles.length === 0) return;
		const shuffled = [...articles].sort(() => Math.random() - 0.5);
		setSelectedArticleIds(new Set(shuffled.slice(0, Math.min(count, shuffled.length)).map((article) => article.id)));
	};

	const applyImageQuality = (qualityId) => {
		setImageQuality(qualityId);
		const quality = imageQualities.find((item) => item.id === qualityId);
		if (!quality) return;
		setPanel((prev) => ({
			...prev,
			imageMode: quality.imageMode,
			imageProvider: quality.imageProvider,
		}));
	};

	const handleReferenceUpload = (event) => {
		const files = Array.from(event.target.files || []).slice(0, 6);
		const next = files.map((file) => ({
			id: `${file.name}-${file.lastModified}`,
			name: file.name,
			url: URL.createObjectURL(file),
		}));
		setReferenceImages((prev) => {
			prev.forEach((item) => URL.revokeObjectURL(item.url));
			return next;
		});
		event.target.value = '';
	};

	const removeReferenceImage = (id) => {
		setReferenceImages((prev) => {
			const target = prev.find((item) => item.id === id);
			if (target) URL.revokeObjectURL(target.url);
			return prev.filter((item) => item.id !== id);
		});
	};

	const openInspectorForSaved = (pinId) => {
		setEditingPinId(pinId);
		setSelectedPreviewTempId('');
	};

	const openInspectorForPreview = (tempId) => {
		setSelectedPreviewTempId(tempId);
		setEditingPinId('');
	};

	const closeInspector = () => {
		setEditingPinId('');
		setSelectedPreviewTempId('');
	};

	const updateInspectorField = (key, value) => {
		if (editingPinId) {
			updatePinField(editingPinId, key, value);
			return;
		}
		if (selectedPreviewTempId) {
			updateGeneratedPreviewField(selectedPreviewTempId, key, value);
		}
	};

	const generateLabel = createMode === 'bulk'
		? `Generate ${Math.max(1, selectedArticleIds.size) * panel.count} Pins`
		: panel.count > 1
			? `Generate ${panel.count} Pins`
			: 'Generate Pin';

	return (
		<div className="ai-pins-atelier">
			<div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{platformName} Studio</p>
					<h1 className="font-display text-3xl font-semibold tracking-tight">AI Pins Atelier</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Compose Pinterest-ready drafts from pages, bulk catalogs, or free prompts — then refine title, description, keywords, and imagery before publishing.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{showBrandKit ? <Link to="/app/ai-pins/brand-kit"><Button variant="outline" size="sm"><Palette size={14} /> Brand Kit</Button></Link> : null}
					{showTemplates ? <Link to="/app/ai-pins/templates"><Button variant="outline" size="sm"><LayoutTemplate size={14} /> Templates</Button></Link> : null}
					{showHistory ? <Link to="/app/ai-pins/history"><Button variant="outline" size="sm"><History size={14} /> History</Button></Link> : null}
					<div
						className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-sm"
						title={`config v${configVersion} · ${cacheStatus}${configRefreshing ? ' · refreshing' : ''}`}
					>
						<span className="text-muted-foreground">AI </span>{credits.ai?.remaining ?? 0}
						<span className="mx-1.5 text-border">·</span>
						<span className="text-muted-foreground">Img </span>{credits.image?.remaining ?? 0}
					</div>
				</div>
			</div>

			{showPinterest && accounts.length === 0 && !loadingAccounts ? (
				<div className="mb-4 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-sm text-foreground/90">Connect Pinterest to schedule and publish pins from this studio.</p>
					<Link to="/app/pinterest"><Button size="sm">Connect Pinterest</Button></Link>
				</div>
			) : null}

			{bulkProgress.active ? (
				<div className="mb-4 rounded-2xl border border-border bg-card p-4">
					<div className="mb-2 flex items-center justify-between gap-3">
						<p className="text-sm font-medium">{bulkProgress.message || 'Working…'}</p>
						<span className="text-xs text-muted-foreground">{bulkProgress.current}/{bulkProgress.total}</span>
					</div>
					<div className="ai-pins-progress">
						<span style={{ width: `${Math.round((bulkProgress.current / Math.max(1, bulkProgress.total)) * 100)}%` }} />
					</div>
				</div>
			) : null}

			<div className={`ai-pins-atelier__shell ${inspectorPin ? 'is-inspecting' : ''}`}>
				<aside className="ai-pins-atelier__rail p-4">
					<div className="mb-4 flex items-start justify-between gap-2">
						<div>
							<h2 className="font-display text-xl font-semibold">Create</h2>
							<p className="text-xs text-muted-foreground">{platformName} pin workflow</p>
						</div>
						<span className="rounded-full bg-accent/20 px-2.5 py-1 text-[11px] font-semibold text-accent-foreground">
							{(credits.ai?.remaining ?? 0)} credits
						</span>
					</div>

					<div className="ai-pins-mode-tabs mb-4">
						{CREATE_MODES.map(({ id, label, icon: Icon }) => (
							<button
								key={id}
								type="button"
								className={createMode === id ? 'is-active' : ''}
								onClick={() => setCreateMode(id)}
							>
								<Icon size={13} className="mx-auto mb-1" />
								{label}
							</button>
						))}
					</div>

					<div className="space-y-4">
						<Select label="Website" value={websiteId} onChange={(e) => setWebsiteId(e.target.value)} disabled={loadingWebsites}>
							<option value="">Select website</option>
							{websites.map((website) => (
								<option key={website.id} value={website.id}>{website.name || website.domain || website.id}</option>
							))}
						</Select>

						{createMode === 'prompt' ? (
							<>
								<Textarea
									label="Prompt"
									rows={5}
									value={promptOnlyText}
									onChange={(e) => setPromptOnlyText(e.target.value)}
									placeholder="Describe the pin idea, mood, cuisine, and CTA…"
								/>
								<Input
									label="Pin text overlay"
									value={panel.textOverlay}
									onChange={(e) => setPanel((prev) => ({ ...prev, textOverlay: e.target.value }))}
									placeholder="Short overlay text"
								/>
								<div className="rounded-xl border border-dashed border-border bg-background/60 p-3 text-xs text-muted-foreground">
									Prompt Only still anchors to one article for saving. Select an article below if needed.
								</div>
								<Select label="Anchor article" value={activeArticleId} onChange={(e) => setActiveArticleId(e.target.value)}>
									<option value="">Select article</option>
									{articles.map((article) => (
										<option key={article.id} value={article.id}>{article.title || article.slug || article.url}</option>
									))}
								</Select>
							</>
						) : null}

						{createMode === 'single' ? (
							<>
								<Select label="Article" value={activeArticleId} onChange={(e) => setActiveArticleId(e.target.value)}>
									<option value="">Select article</option>
									{articles.map((article) => (
										<option key={article.id} value={article.id}>{article.title || article.slug || article.url}</option>
									))}
								</Select>
								<Input
									label="Pin text overlay"
									value={panel.textOverlay}
									onChange={(e) => setPanel((prev) => ({ ...prev, textOverlay: e.target.value }))}
								/>
								<div className="flex gap-2">
									<Button type="button" size="sm" variant="outline" className="flex-1" onClick={handleAnalyzeArticle} disabled={analyzing || !activeArticle}>
										{analyzing ? 'Analyzing…' : 'Analyze'}
									</Button>
									<Button type="button" size="sm" variant="outline" className="flex-1" onClick={handleGeneratePrompt} disabled={!activeArticle}>
										Prompt
									</Button>
								</div>
							</>
						) : null}

						{createMode === 'bulk' ? (
							<div className="space-y-3 rounded-2xl border border-border bg-background/55 p-3">
								<div className="flex items-center gap-2">
									<Search size={14} className="text-muted-foreground" />
									<input
										className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
										value={articleSearch}
										onChange={(e) => setArticleSearch(e.target.value)}
										placeholder="Search articles…"
									/>
								</div>
								<div className="flex flex-wrap gap-2">
									<Select value={articleStatus} onChange={(e) => { setArticleStatus(e.target.value); setArticlePage(1); }} className="min-w-[7rem]">
										<option value="">All</option>
										<option value="new">New</option>
										<option value="imported">Imported</option>
										<option value="published">Published</option>
									</Select>
									<Select value={articleCategory} onChange={(e) => { setArticleCategory(e.target.value); setArticlePage(1); }} className="min-w-[7rem]">
										<option value="">Categories</option>
										{articleCategories.map((item) => <option key={item} value={item}>{item}</option>)}
									</Select>
								</div>
								<div className="flex flex-wrap gap-1.5 text-[11px]">
									<button type="button" className="rounded-full border border-border px-2.5 py-1 hover:bg-secondary" onClick={selectAllArticles}>Select all</button>
									<button type="button" className="rounded-full border border-border px-2.5 py-1 hover:bg-secondary" onClick={() => selectRandomArticles(1)}>Random 1</button>
									<button type="button" className="rounded-full border border-border px-2.5 py-1 hover:bg-secondary" onClick={() => selectRandomArticles(3)}>Random 3</button>
									<button type="button" className="rounded-full border border-border px-2.5 py-1 hover:bg-secondary" onClick={clearArticleSelection}>Clear</button>
									<span className="ml-auto self-center text-muted-foreground">{selectedArticleIds.size} selected</span>
								</div>
								<div className="max-h-52 overflow-auto rounded-xl border border-border/80">
									{loadingArticles ? (
										<div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"><Spinner className="h-4 w-4" /> Loading…</div>
									) : articles.length === 0 ? (
										<p className="p-4 text-xs text-muted-foreground">No articles found for this website.</p>
									) : articles.map((article) => {
										const checked = selectedArticleIds.has(article.id);
										const active = activeArticleId === article.id;
										return (
											<label key={article.id} className={`flex cursor-pointer items-start gap-2 border-b border-border/70 px-2.5 py-2 last:border-0 ${active ? 'bg-primary/5' : ''}`}>
												<input type="checkbox" className="mt-1" checked={checked} onChange={() => toggleArticleSelection(article.id)} />
												<button type="button" className="min-w-0 flex-1 text-left" onClick={() => setActiveArticleId(article.id)}>
													<p className="truncate text-xs font-medium">{article.title || article.slug}</p>
													<p className="truncate text-[11px] text-muted-foreground">{article.url}</p>
												</button>
											</label>
										);
									})}
								</div>
								<div className="flex items-center justify-between gap-2">
									<Button type="button" size="sm" variant="outline" onClick={() => setManualOpen(true)} disabled={!websiteId}>Add article</Button>
									<div className="flex gap-1">
										<Button type="button" size="sm" variant="ghost" disabled={articlePage <= 1} onClick={() => setArticlePage((p) => Math.max(1, p - 1))}>Prev</Button>
										<span className="self-center text-[11px] text-muted-foreground">{articlePage}/{articleTotalPages}</span>
										<Button type="button" size="sm" variant="ghost" disabled={articlePage >= articleTotalPages} onClick={() => setArticlePage((p) => p + 1)}>Next</Button>
									</div>
								</div>
							</div>
						) : null}

						{(createMode === 'single' || createMode === 'prompt') ? (
							<div className="flex justify-end">
								<Button type="button" size="sm" variant="outline" onClick={() => setManualOpen(true)} disabled={!websiteId}>Add manual article</Button>
							</div>
						) : null}

						<label className="flex items-center gap-2 text-sm">
							<input type="checkbox" checked={includeWebsiteUrl} onChange={(e) => setIncludeWebsiteUrl(e.target.checked)} />
							Include website URL on pin
						</label>

						<div className="grid grid-cols-2 gap-3">
							<Select label="Image type" value={imageType} onChange={(e) => setImageType(e.target.value)}>
								<option value="pin">Pin</option>
								<option value="story">Story</option>
								<option value="carousel">Carousel frame</option>
							</Select>
							<Select label="Number of pins" value={String(panel.count)} onChange={(e) => setPanel((prev) => ({ ...prev, count: Number(e.target.value) }))}>
								{pinCounts.map((count) => <option key={count} value={count}>{count}</option>)}
							</Select>
						</div>

						<div>
							<p className="mb-1.5 text-sm font-medium">Image quality</p>
							<div className="ai-pins-chip-row">
								{imageQualities.map((item) => (
									<button
										key={item.id}
										type="button"
										className={`ai-pins-chip ${imageQuality === item.id ? 'is-active' : ''}`}
										onClick={() => applyImageQuality(item.id)}
									>
										<p className="text-xs font-semibold">{item.label}</p>
										<p className="mt-0.5 text-[10px] text-muted-foreground">{item.hint}</p>
									</button>
								))}
							</div>
						</div>

						<div>
							<p className="mb-1.5 text-sm font-medium">Pinterest size</p>
							<div className="grid grid-cols-4 gap-2">
								{PIN_ASPECT_RATIOS.map((item) => (
									<button
										key={item.id}
										type="button"
										className={`ai-pins-ratio ${aspectRatio === item.id ? 'is-active' : ''}`}
										onClick={() => setAspectRatio(item.id)}
									>
										<span className={`ai-pins-ratio__frame ${item.frame}`} />
										<span>{item.label}</span>
										<span className="text-[10px] font-normal text-muted-foreground">{item.ratio}</span>
									</button>
								))}
							</div>
						</div>

						<div>
							<div className="mb-1.5 flex items-center justify-between">
								<p className="text-sm font-medium">Reference images</p>
								<button type="button" className="text-xs text-primary" onClick={() => referenceInputRef.current?.click()}>Upload</button>
							</div>
							<input ref={referenceInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleReferenceUpload} />
							<div className="flex flex-wrap gap-2">
								{referenceImages.length === 0 ? (
									<button type="button" onClick={() => referenceInputRef.current?.click()} className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground hover:bg-secondary">
										<Images size={16} />
									</button>
								) : referenceImages.map((image) => (
									<div key={image.id} className="relative h-16 w-16 overflow-hidden rounded-xl border border-border">
										<img src={image.url} alt={image.name} className="h-full w-full object-cover" />
										<button type="button" className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5" onClick={() => removeReferenceImage(image.id)}>
											<X size={10} />
										</button>
									</div>
								))}
							</div>
						</div>

						<button
							type="button"
							className="flex w-full items-center justify-between rounded-xl border border-border bg-background/50 px-3 py-2.5 text-sm font-medium"
							onClick={() => setAdvancedOpen((open) => !open)}
						>
							Advanced settings
							<ChevronDown size={16} className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
						</button>

						{advancedOpen ? (
							<div className="space-y-3 rounded-2xl border border-border bg-background/60 p-3">
								<div className="space-y-2">
									<Select label="Template" value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} disabled={!showTemplates}>
										<option value="">System default</option>
										{templates.map((template) => (
											<option key={template.id} value={template.id}>{template.name}{template.isDefault ? ' (Default)' : ''}</option>
										))}
									</Select>
									<Button type="button" size="sm" variant="outline" className="w-full" onClick={handleChooseDesignLibraryTemplate}>
										<Library size={13} /> Choose Template
									</Button>
									<p className="text-[10px] text-muted-foreground">Design Library integration ready — chooser plugs in here later.</p>
								</div>
								<Select label="Brand Kit" value={selectedBrandKitId} onChange={(e) => setSelectedBrandKitId(e.target.value)} disabled={!showBrandKit}>
									<option value="">No brand kit</option>
									{brandKits.map((kit) => (
										<option key={kit.id} value={kit.id}>{kit.name}{kit.isDefault ? ' (Default)' : ''}</option>
									))}
								</Select>
								<Select label="Pin style" value={panel.style} onChange={(e) => setPanel((prev) => ({ ...prev, style: e.target.value }))}>
									{pinStyles.length === 0 ? <option value="">No styles configured</option> : null}
									{pinStyles.map((style) => <option key={style} value={style}>{style}</option>)}
								</Select>
								<Input label="Pin title seed" value={panel.pinTitle} onChange={(e) => setPanel((prev) => ({ ...prev, pinTitle: e.target.value }))} />
								<Textarea label="Description seed" rows={3} value={panel.pinDescription} onChange={(e) => setPanel((prev) => ({ ...prev, pinDescription: e.target.value }))} />
								<Input label="Target audience" value={panel.targetAudience} onChange={(e) => setPanel((prev) => ({ ...prev, targetAudience: e.target.value }))} />
								<Input label="Tone of voice" value={panel.toneOfVoice} onChange={(e) => setPanel((prev) => ({ ...prev, toneOfVoice: e.target.value }))} />
								<Input label="Language" value={panel.language} onChange={(e) => setPanel((prev) => ({ ...prev, language: e.target.value }))} />
								<Select label="Image provider" value={panel.imageProvider} onChange={(e) => setPanel((prev) => ({ ...prev, imageProvider: e.target.value }))} disabled={!showAiImages || panel.imageMode !== 'generate_ai'}>
									<option value="">Select provider</option>
									{imageProviders.map((provider) => (
										<option key={provider.id || provider.code} value={provider.code}>{provider.name || provider.code}</option>
									))}
								</Select>
								{analysis ? (
									<div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground space-y-1">
										<p><span className="font-medium text-foreground">CTA:</span> {analysis.cta || '—'}</p>
										<p><span className="font-medium text-foreground">Category:</span> {analysis.pinterestCategory || '—'}</p>
										<p><span className="font-medium text-foreground">Keywords:</span> {(analysis.keywords || []).join(', ') || '—'}</p>
									</div>
								) : null}
							</div>
						) : null}
					</div>

					<div className="sticky bottom-0 mt-5 space-y-2 border-t border-border/80 bg-gradient-to-t from-card via-card to-transparent pt-4">
						<p className="text-[10px] text-muted-foreground">
							Config v{configVersion} · {cacheStatus}{configRefreshing ? ' · refreshing' : ''}
							{lastRefreshDurationMs ? ` · ${lastRefreshDurationMs}ms` : ''}
							{lastConfigUpdate ? ` · ${new Date(lastConfigUpdate).toLocaleTimeString()}` : ''}
						</p>
						<p className="text-xs text-muted-foreground">
							This will use ~{estimatedCredits} credits
							{credits?.ai?.remaining != null ? ` · ${Math.max(0, Number((credits.ai.remaining - estimatedCredits).toFixed(2)))} left` : ''}.
						</p>
						<Button className="w-full" onClick={handleGenerate} disabled={generating || loadingArticles}>
							{generating ? <Spinner className="h-4 w-4" /> : <Wand2 size={16} />}
							{generating ? 'Generating…' : generateLabel}
						</Button>
					</div>
				</aside>

				<section className="ai-pins-atelier__canvas p-4 sm:p-5">
					<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex flex-wrap gap-1 rounded-xl border border-border bg-background/70 p-1">
							{[
								{ id: 'studio', label: 'Studio', icon: Sparkles },
								{ id: 'library', label: 'Library', icon: Images },
								{ id: 'queue', label: 'Queue', icon: ListChecks },
							].map(({ id, label, icon: Icon }) => (
								<button
									key={id}
									type="button"
									onClick={() => setWorkspaceTab(id)}
									className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${workspaceTab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}
								>
									<Icon size={13} /> {label}
								</button>
							))}
						</div>
						<div className="flex flex-wrap items-center gap-2">
							{generatingImages ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Spinner className="h-3.5 w-3.5" /> Rendering images…</span> : null}
							{generatedPreviewPins.length > 0 ? (
								<>
									<Button size="sm" variant="outline" onClick={() => setGeneratedPreviewPins([])}>Discard</Button>
									<Button size="sm" onClick={saveGeneratedPreviewPins} disabled={savingGenerated}>
										{savingGenerated ? <Spinner className="h-4 w-4" /> : null} Save drafts
									</Button>
								</>
							) : null}
						</div>
					</div>

					{workspaceTab === 'studio' ? (
						<>
							{generating && generatedPreviewPins.length === 0 ? (
								<div className="ai-pins-grid">
									{[0, 1, 2].map((item) => (
										<div key={item} className="ai-pins-skeleton" style={{ animationDelay: `${item * 80}ms` }}>
											<div className="ai-pins-skeleton__shine" />
										</div>
									))}
								</div>
							) : generatedPreviewPins.length > 0 ? (
								<div className="ai-pins-grid">
									{generatedPreviewPins.map((pin, index) => (
										<article
											key={pin.tempId}
											className={`ai-pins-card ${selectedPreviewTempId === pin.tempId ? 'is-selected' : ''}`}
											style={{ animationDelay: `${index * 45}ms` }}
											onClick={() => openInspectorForPreview(pin.tempId)}
										>
											<div className="ai-pins-card__media">
												{pin.imageUrl ? (
													<img src={pin.imageUrl} alt={pin.title} loading="lazy" decoding="async" />
												) : (
													<div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
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
													</div>
												)}
											</div>
											<div className="space-y-2 p-3">
												<div className="flex items-center justify-between gap-2">
													<Badge tone={pin.imageGenerationStatus === 'failed' ? 'red' : pin.imageGenerationStatus === 'completed' ? 'green' : 'amber'}>
														{pin.imageGenerationStatus || 'draft'}
													</Badge>
													<span className="truncate text-[10px] text-muted-foreground">{pin.templateName}</span>
												</div>
												<h3 className="line-clamp-2 font-display text-sm font-semibold leading-snug">{pin.title}</h3>
												<p className="line-clamp-2 text-xs text-muted-foreground">{pin.description}</p>
												<div className="flex gap-1.5 pt-1">
													<Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); regeneratePreviewImage(pin); }} disabled={panel.imageMode !== 'generate_ai' || generatingImages}>
														<RefreshCw size={12} /> Retry
													</Button>
													<Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); downloadImage(pin.imageUrl, pin.title); }} disabled={!pin.imageUrl}>
														<Download size={12} />
													</Button>
												</div>
											</div>
										</article>
									))}
								</div>
							) : (
								<div className="flex min-h-[28rem] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background/40 px-6 text-center">
									<div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
										<Wand2 size={28} />
									</div>
									<h3 className="font-display text-2xl font-semibold">Your pin canvas is ready</h3>
									<p className="mt-2 max-w-md text-sm text-muted-foreground">
										Pick a mode on the left, tune quality and size, then generate. Previews appear here as tall Pinterest cards with live progress.
									</p>
									<div className="mt-5 flex flex-wrap justify-center gap-2">
										<span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">{createMode === 'bulk' ? `${selectedArticleIds.size} pages selected` : (activeArticle?.title || 'No page selected')}</span>
										{selectedBrandKit ? <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Brand: {selectedBrandKit.name}</span> : null}
									</div>
								</div>
							)}
						</>
					) : null}

					{workspaceTab === 'library' ? (
						<>
							<div className="mb-4 space-y-3 rounded-2xl border border-border bg-background/50 p-3">
								<div className="flex flex-col gap-3 lg:flex-row lg:items-end">
									<Select label="Pinterest account" value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)} disabled={loadingAccounts || accounts.length === 0}>
										<option value="">Select account</option>
										{accounts.map((account) => (
											<option key={account.id} value={account.id}>
												{account.label || account.accountName || account.username}
												{account.isDefault ? ' (Default)' : ''}
											</option>
										))}
									</Select>
									<Select label="Board" value={selectedBoardId} onChange={(e) => setSelectedBoardId(e.target.value)} disabled={loadingBoards || boards.length === 0}>
										<option value="">Select board</option>
										{boards.map((board) => (
											<option key={board.id} value={board.boardId}>
												{board.name}
												{board.isDefault ? ' (Default)' : ''}
											</option>
										))}
									</Select>
									<div className="rounded-xl border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground lg:min-w-[12rem]">
										<p className="font-medium text-foreground">Workspace queue</p>
										<p>{publishingConfig.timezone} · {publishingConfig.dailyLimit}/day · every {publishingConfig.intervalMinutes}m</p>
										<p className="truncate">{publishingConfig.schedulingMode} · retry {publishingConfig.retryPolicy.raw}{publishingConfig.autoPublish ? ' · auto-publish' : ''}</p>
										<p className="truncate text-[10px]">config v{publishingConfig.configVersion}</p>
									</div>
								</div>
								<div className="flex flex-wrap gap-2">
									<Button size="sm" onClick={() => runPublishNow()} disabled={publishing || selectedDraftPins.length === 0 || boards.length === 0}>
										<Send size={13} /> Publish Now
									</Button>
									<Button size="sm" variant="outline" onClick={() => openScheduleModal()} disabled={publishing || scheduling || selectedDraftPins.length === 0 || boards.length === 0}>
										<CalendarClock size={13} /> Schedule
									</Button>
									<Button size="sm" variant="outline" onClick={() => handleAddToQueue()} disabled={queueing || publishing || selectedDraftPins.length === 0 || boards.length === 0}>
										<ListPlus size={13} /> Add to Queue
									</Button>
									<Button size="sm" variant="outline" onClick={async () => {
										if (generatedPreviewPins.length > 0) {
											await saveGeneratedPreviewPins();
											return;
										}
										if (inspectorPin && editingPinId) {
											await handleSaveEdit(inspectorPin);
											return;
										}
										toast({ title: 'Drafts', description: 'Generate pins in Studio then Save Draft, or edit a library pin and save.' });
									}} disabled={savingGenerated}>
										{savingGenerated ? <Spinner className="h-3.5 w-3.5" /> : null} Save Draft
									</Button>
									{showHistory ? (
										<Link to="/app/pinterest-history"><Button size="sm" variant="ghost"><History size={13} /> History</Button></Link>
									) : null}
								</div>
							</div>

							<div className="mb-3 flex flex-wrap items-center gap-2">
								<select className="rounded-xl border border-input bg-background px-3 py-2 text-xs" value={pinFilter} onChange={(e) => setPinFilter(e.target.value)}>
									<option value="all">All pins</option>
									<option value="draft">Drafts</option>
									<option value="scheduled">Scheduled</option>
									<option value="published">Published</option>
									<option value="failed">Failed</option>
								</select>
								<div className="relative min-w-[12rem] flex-1">
									<Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
									<input
										className="w-full rounded-xl border border-input bg-background py-2 pl-8 pr-3 text-xs outline-none focus:ring-2 focus:ring-ring/20"
										placeholder="Filter by title or URL…"
										value={pinSearch}
										onChange={(e) => setPinSearch(e.target.value)}
									/>
								</div>
								<Button size="sm" variant="outline" onClick={selectAllDraftPins}><CheckSquare size={13} /> Select drafts</Button>
								<Button size="sm" variant="ghost" onClick={clearDraftPinSelection}><Square size={13} /> Clear</Button>
								{loadingPins ? <Spinner className="h-4 w-4" /> : <span className="text-xs text-muted-foreground">{filteredSavedPins.length} pins</span>}
							</div>

							{filteredSavedPins.length === 0 ? (
								<Empty icon={Sparkles} title="No pins in this view" subtitle="Generate and save drafts to fill your library." />
							) : (
								<div className="ai-pins-grid">
									{filteredSavedPins.map((pin, index) => {
										const checked = selectedDraftPinIds.has(pin.id);
										return (
											<article
												key={pin.id}
												className={`ai-pins-card ${editingPinId === pin.id ? 'is-selected' : ''}`}
												style={{ animationDelay: `${index * 40}ms` }}
												onClick={() => openInspectorForSaved(pin.id)}
											>
												<div className="absolute left-2 top-2 z-10">
													<input
														type="checkbox"
														checked={checked}
														disabled={pin.status === 'published'}
														onClick={(e) => e.stopPropagation()}
														onChange={() => toggleDraftPinSelection(pin.id)}
														className="h-4 w-4 rounded border-border"
													/>
												</div>
												<div className="ai-pins-card__media">
													{pin.imageUrl ? (
														<img src={pin.imageUrl} alt={pin.title} loading="lazy" decoding="async" />
													) : (
														<div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
															<Globe size={22} />
															<p className="text-xs">Image required to publish</p>
														</div>
													)}
												</div>
												<div className="space-y-2 p-3">
													<div className="flex items-center justify-between">
														<Badge tone={pin.status === 'published' ? 'green' : pin.status === 'failed' ? 'red' : pin.status === 'scheduled' ? 'amber' : 'blue'}>{pin.status}</Badge>
														<span className="text-[10px] text-muted-foreground">{pin.boardName || 'No board'}</span>
													</div>
													<h3 className="line-clamp-2 font-display text-sm font-semibold">{pin.title}</h3>
													<p className="line-clamp-2 text-xs text-muted-foreground">{pin.description}</p>
													<div className="flex flex-wrap gap-1.5">
														<Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openInspectorForSaved(pin.id); }}><Pencil size={12} /> Edit</Button>
														<Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handlePreviewPin(pin); }}><Eye size={12} /> Preview</Button>
														<Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleDuplicatePin(pin); }}><Copy size={12} /></Button>
														<Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleDeletePin(pin.id); }}><Trash2 size={12} /></Button>
													</div>
												</div>
											</article>
										);
									})}
								</div>
							)}
						</>
					) : null}

					{workspaceTab === 'queue' ? (
						<div className="space-y-4">
							<div className="rounded-2xl border border-border bg-background/60 p-4">
								<h3 className="font-semibold">Smart publishing queue</h3>
								<p className="mt-1 text-xs text-muted-foreground">
									Slots follow Workspace Config: {publishingConfig.timezone}, {publishingConfig.dailyLimit}/day,
									{' '}every {publishingConfig.intervalMinutes}m, windows {publishingConfig.publishingWindows.map((w) => `${w.start}–${w.end}`).join(', ')},
									{' '}retry {publishingConfig.retryPolicy.raw}. Scheduled pins appear on Calendar automatically.
								</p>
								<div className="mt-3 flex flex-wrap gap-2">
									<Button size="sm" onClick={() => handleAddToQueue()} disabled={queueing || selectedDraftPins.length === 0}>
										<ListPlus size={13} /> Add selected to queue
									</Button>
									{showHistory ? (
										<Link to="/app/pinterest-history"><Button size="sm" variant="outline"><History size={13} /> Publishing History</Button></Link>
									) : null}
								</div>
							</div>
							{failedPins.length === 0 && savedPins.filter((pin) => pin.status === 'scheduled' || pin.status === 'publishing').length === 0 ? (
								<Empty icon={ListChecks} title="Queue is clear" subtitle="Failed or scheduled pins will appear here." />
							) : (
								<div className="space-y-3">
									{savedPins.filter((pin) => pin.status === 'failed' || pin.status === 'scheduled' || pin.status === 'publishing').map((pin) => (
										<Card key={pin.id} className="flex flex-col gap-3 sm:flex-row sm:items-center">
											<div className="h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-secondary">
												{pin.imageUrl ? <img src={pin.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
											</div>
											<div className="min-w-0 flex-1">
												<div className="mb-1 flex items-center gap-2">
													<Badge tone={pin.status === 'failed' ? 'red' : 'amber'}>{pin.status}</Badge>
													<p className="truncate text-sm font-medium">{pin.title}</p>
												</div>
												{pin.publishError ? <p className="text-xs text-destructive">{pin.publishError}</p> : null}
												{pin.scheduledAt ? <p className="text-xs text-muted-foreground">Scheduled {new Date(pin.scheduledAt).toLocaleString()}</p> : null}
											</div>
											<div className="flex gap-2">
												<Button size="sm" variant="outline" onClick={() => openInspectorForSaved(pin.id)}>Edit</Button>
												<Button size="sm" variant="outline" onClick={() => handlePreviewPin(pin)}><Eye size={13} /></Button>
												{pin.status === 'failed' ? (
													<Button size="sm" onClick={() => runPublishNow([pin])} disabled={publishing}><Send size={13} /> Publish Now</Button>
												) : null}
											</div>
										</Card>
									))}
								</div>
							)}
						</div>
					) : null}
				</section>

				{inspectorPin ? (
					<aside className="ai-pins-atelier__inspector p-4">
						<div className="mb-4 flex items-start justify-between gap-2">
							<div>
								<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Inspector</p>
								<h3 className="font-display text-lg font-semibold">Pin details</h3>
							</div>
							<button type="button" className="rounded-lg border border-border p-1.5 hover:bg-secondary" onClick={closeInspector}>
								<X size={14} />
							</button>
						</div>

						<div className="mb-4 overflow-hidden rounded-2xl border border-border">
							<div className="aspect-[2/3] bg-secondary">
								{inspectorPin.imageUrl ? (
									<img src={inspectorPin.imageUrl} alt={inspectorPin.title} className="h-full w-full object-cover" />
								) : inspectorPin.templateConfig ? (
									<div className="p-2">
										<TemplatePreviewCard
											config={inspectorPin.templateConfig}
											context={{
												title: inspectorPin.title,
												description: inspectorPin.description,
												category: inspectorPin.category,
												website: inspectorPin.website,
												author: inspectorPin.author,
												overlayText: inspectorPin.overlayText,
											}}
										/>
									</div>
								) : (
									<div className="flex h-full items-center justify-center text-xs text-muted-foreground"><ImageIcon size={16} className="mr-1" /> No image</div>
								)}
							</div>
						</div>

						<div className="space-y-3">
							<Input label="Title" value={inspectorPin.title || ''} onChange={(e) => updateInspectorField('title', e.target.value)} />
							<Textarea label="Description" rows={4} value={inspectorPin.description || ''} onChange={(e) => updateInspectorField('description', e.target.value)} />
							<Input label="Overlay" value={inspectorPin.overlayText || ''} onChange={(e) => updateInspectorField('overlayText', e.target.value)} />
							<Textarea label="Image prompt" rows={4} value={inspectorPin.imagePrompt || ''} onChange={(e) => updateInspectorField('imagePrompt', e.target.value)} />
							<Input
								label="Keywords"
								value={safeArray(inspectorPin.suggestedKeywords).join(', ')}
								onChange={(e) => updateInspectorField('suggestedKeywords', safeArray(e.target.value))}
							/>
							<Input
								label="Hashtags"
								value={safeArray(inspectorPin.suggestedHashtags).join(', ')}
								onChange={(e) => updateInspectorField('suggestedHashtags', safeArray(e.target.value))}
							/>
							<Input label="Image URL" value={inspectorPin.imageUrl || ''} onChange={(e) => updateInspectorField('imageUrl', e.target.value)} />

							<Select label="Brand Kit" value={inspectorPin.brandKitId || selectedBrandKitId} onChange={(e) => {
								updateInspectorField('brandKitId', e.target.value);
								setSelectedBrandKitId(e.target.value);
							}}>
								<option value="">No brand kit</option>
								{brandKits.map((kit) => (
									<option key={kit.id} value={kit.id}>{kit.name}</option>
								))}
							</Select>

							{editingPinId ? (
								<>
									<Select label="Template" value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
										<option value="">System default</option>
										{templates.map((template) => (
											<option key={template.id} value={template.id}>{template.name}</option>
										))}
									</Select>
									<Button type="button" size="sm" variant="outline" className="w-full" onClick={handleChooseDesignLibraryTemplate}>
										<Library size={13} /> Choose Template
									</Button>
									<Select label="Target account" value={inspectorPin.accountId || ''} onChange={(e) => setPinTargetAccount(inspectorPin.id, e.target.value)}>
										<option value="">Use global account</option>
										{accounts.map((account) => (
											<option key={account.id} value={account.id}>{account.label || account.accountName || account.username}</option>
										))}
									</Select>
									<Select label="Target board" value={inspectorPin.boardId || ''} onChange={(e) => updatePinField(inspectorPin.id, 'boardId', e.target.value)}>
										<option value="">Use global board</option>
										{(boardsByAccount[inspectorPin.accountId || selectedAccountId] || boards).map((board) => (
											<option key={board.id} value={board.boardId}>{board.name}</option>
										))}
									</Select>
									<Input
										label="Schedule (optional)"
										type="datetime-local"
										value={inspectorPin.scheduledAt ? String(inspectorPin.scheduledAt).slice(0, 16) : ''}
										onChange={(e) => updateInspectorField('scheduledAt', e.target.value ? new Date(e.target.value).toISOString() : '')}
									/>
									<Input
										label="Schedule timezone"
										value={inspectorPin.scheduledTimezone || publishingConfig.timezone || timezone}
										onChange={(e) => updateInspectorField('scheduledTimezone', e.target.value)}
									/>
								</>
							) : null}

							<div className="flex flex-wrap gap-2 pt-2">
								{editingPinId ? (
									<>
										<Button className="flex-1" onClick={() => handleSaveEdit(inspectorPin)}>Save Draft</Button>
										<Button variant="outline" onClick={() => handlePreviewPin(inspectorPin)}><Eye size={14} /> Preview</Button>
										<Button variant="outline" onClick={() => runPublishNow([inspectorPin])} disabled={publishing || !showPinterest}><Send size={14} /></Button>
										<Button variant="outline" onClick={() => { setActionPinIds([inspectorPin.id]); openScheduleModal([inspectorPin]); }} disabled={scheduling}><CalendarClock size={14} /></Button>
										<Button variant="outline" onClick={() => { setActionPinIds([inspectorPin.id]); handleAddToQueue([inspectorPin]); }} disabled={queueing}><ListPlus size={14} /></Button>
										<Button variant="outline" onClick={() => handleDuplicatePin(inspectorPin)}><Copy size={14} /></Button>
										<Button variant="outline" onClick={() => handleRegeneratePin(inspectorPin)} disabled={generating}><RefreshCw size={14} /></Button>
										<Button variant="ghost" onClick={() => handleDeletePin(inspectorPin.id)}><Trash2 size={14} /></Button>
									</>
								) : (
									<>
										<Button className="flex-1" variant="outline" onClick={() => regeneratePreviewImage(inspectorPin)} disabled={panel.imageMode !== 'generate_ai' || generatingImages}>
											<RefreshCw size={14} /> Regenerate image
										</Button>
										<Button variant="outline" onClick={() => handlePreviewPin(inspectorPin)}><Eye size={14} /></Button>
										<Button variant="outline" onClick={() => downloadImage(inspectorPin.imageUrl, inspectorPin.title)} disabled={!inspectorPin.imageUrl}>
											<Download size={14} />
										</Button>
									</>
								)}
							</div>
						</div>
					</aside>
				) : null}
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
				defaultLanguage={panel.language || languageLabelFromConfig(config)}
			/>
			<SchedulePinModal
				open={scheduleModalOpen}
				onClose={() => setScheduleModalOpen(false)}
				onSubmit={handleScheduleSubmit}
				submitting={scheduling}
				accounts={accounts}
				boards={boards}
				defaultAccountId={selectedAccountId}
				defaultBoardId={selectedBoardId}
				defaultTimezone={publishingConfig.timezone || timezone}
				pinCount={actionPinIds.length || selectedDraftPins.length || (editingPinId ? 1 : 0)}
			/>
			<PreviewPinModal
				open={Boolean(previewModal)}
				preview={previewModal}
				onClose={() => setPreviewModal(null)}
				publishing={publishing}
				onPublish={() => {
					const pin = savedPins.find((item) => item.id === previewModal?.id);
					setPreviewModal(null);
					if (pin) runPublishNow([pin]);
				}}
				onSchedule={() => {
					const pin = savedPins.find((item) => item.id === previewModal?.id);
					setPreviewModal(null);
					if (pin) openScheduleModal([pin]);
				}}
			/>
			<PublishProgressModal
				open={publishProgressOpen}
				progress={publishProgress}
				result={publishResult}
				onClose={() => setPublishProgressOpen(false)}
				onOpenHistory={() => navigate('/app/pinterest-history')}
			/>
		</div>
	);
}
