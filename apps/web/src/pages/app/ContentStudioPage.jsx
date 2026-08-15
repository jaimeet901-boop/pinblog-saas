import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
	Wand2, Sparkles, RefreshCw, Trash2, Pencil, Search, Globe, Send, CalendarClock,
	CheckSquare, Square, Download, Image as ImageIcon, Images, Layers, Shuffle,
	ChevronDown, History, LayoutTemplate, Palette, X, FileStack, PenLine, ListChecks,
	Eye, Copy, ListPlus, Library, Share2,
} from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { generateText, extractJson } from '@/lib/aiGenerate';
import { Badge, Button, Card, Empty, Input, Select, Spinner, Textarea } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';
import StudioPreviewCard from '@/components/ai-pins/StudioPreviewCard';
import ArticlePreviewDrawer from '@/components/ai-pins/ArticlePreviewDrawer';
import ManualArticleForm from '@/components/ai-pins/ManualArticleForm';
import SchedulePinModal from '@/components/ai-pins/SchedulePinModal';
import PreviewPinModal from '@/components/ai-pins/PreviewPinModal';
import PublishProgressModal from '@/components/ai-pins/PublishProgressModal';
import { useDestinationConnected } from '@/hooks/useDestinationConnected';
import { AI_PINS_PRODUCT } from '@/lib/studio/products';
import { getDestinationAdapter } from '@/services/studio/destinationAdapters';
import { setSetupReturnPath } from '@/lib/websites/websiteLifecycle';
import PinTemplateChooser from '@/components/ai-pins/PinTemplateChooser';
import UpgradeModal from '@/components/billing/UpgradeModal';
import {
	getTemplateAccess,
	isTemplateAccessLocked,
} from '@/lib/templateAccess';
import {
	PRODUCT_EVENTS,
	buildTemplateEventProps,
	trackProductEvent,
} from '@/lib/productAnalytics';
import {
	PIN_COPY_SOURCE,
	resolveStudioPinCopy,
	withUpdatedImageSourceMeta,
} from '@/lib/aiPinsPinCopy';
import {
	assignIntelligentPinDesigns,
	applyIntelligentTemplateConfig,
} from '@/lib/pinTemplateIntelligence';
import { useWorkspaceConfig } from '@/context/WorkspaceConfigContext';
import {
	buildImageQualityOptions,
	buildPinCountOptions,
	buildPinPromptFromConfig,
	estimatePinCredits,
	languageLabelFromConfig,
	mapStudioBrandKits,
	mapStudioCredits,
	mapStudioPinStyles,
	mapStudioTemplates,
	resolveDefaultImageQualityId,
	resolvePublishingConfig,
} from '@/lib/aiPinsWorkspaceConfig';
import { resolveStudioAssets } from '@/lib/studio/resolveStudioAssets';
import { useWorkspaceWebsites } from '@/hooks/useWorkspaceWebsites';
import {
	normalizeImageSourceStrategy,
	pickArticleImageUrl,
	planImageSource,
	IMAGE_SOURCE_STRATEGY,
} from '@/lib/imageSourceStrategy';
import {
	formatImageSourceLabel,
	normalizeDestinationUrl,
} from '@/lib/pinPublishDestination';
import { traceImageLifecycle } from '@/services/ai-pins/imageLifecycleTrace';
import { traceSourceUrl } from '@/services/ai-pins/sourceUrlTrace';
import {
	mapSavedPin,
	saveDrafts,
	ensurePinsSourceUrl,
	duplicatePin,
	updateDraftPin,
	deleteDraftPin,
	expandRecurrence,
	buildPinPreview,
	openDesignLibraryChooser,
	listReferenceImages,
	uploadReferenceImages,
	deleteReferenceImage,
	composeAndUploadFeaturedPins,
	fetchTemplateCached,
	persistGalleryTemplateSelection,
	readPersistedGalleryTemplateSelection,
	clearPersistedGalleryTemplateSelection,
	resolveGenerateTemplate,
	formatTemplateVersionSnapshot,
	ORIGINAL_TEMPLATE_UNAVAILABLE,
} from '@/services/ai-pins';
import {
	mapPollJobToPinPatch,
	pollPreviewImageJobs,
	resolvePinBackgroundFromJob,
	runLastResortArticleCompose,
	runPreviewImagePipeline,
} from '@/services/ai-pins/previewImagePipeline';
import { isPremiumGalleryTemplate } from '@/services/ai-pins/templateHydration';
import { resolveGalleryThumbnail } from '@/services/templates/previewCache';
import './AIPinsPage.css';
import './AIFacebookPages.css';

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

/** Prefer domain/URL — website.name is often the scraped HTML page title. */
function websiteOptionLabel(website) {
	const domain = String(website?.domain || '').trim();
	if (domain) return domain;
	const url = String(website?.url || '').trim();
	if (url) {
		try {
			return new URL(url).hostname || url;
		} catch {
			return url;
		}
	}
	const name = String(website?.name || '').trim();
	return name || String(website?.id || '');
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

export default function ContentStudioPage({ product = AI_PINS_PRODUCT }) {
	const L = product.labels;
	const routes = product.routes;
	const isFacebookStudio = product.destinationId === 'facebook';
	const previewVariant = isFacebookStudio ? 'facebook' : 'pinterest';
	const studioChannel = product.destinationId === 'facebook' ? 'facebook' : 'pinterest';
	const { toast } = useToast();
	const { platformName } = usePlatformIdentity();
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
	const studioAssets = useMemo(() => resolveStudioAssets(product, config), [product, config]);
	const destination = getDestinationAdapter(product.destinationId);
	const destinationCaps = destination.channelCapabilities || {
		schedule: true,
		publishNow: true,
		queueImplemented: true,
	};
	const showPublishingHistory = destinationCaps.publishingHistory !== false;

	const previousStatusesRef = useRef(new Map());
	const defaultsAppliedRef = useRef(false);
	const articleIdFromQueryAppliedRef = useRef(false);
	const [searchParams] = useSearchParams();
	const preferredWebsiteId = String(searchParams.get('websiteId') || '').trim();
	const preferredArticleId = String(searchParams.get('articleId') || '').trim();
	const setupPublish = searchParams.get('setup') === 'publish';
	const openManualFromQuery = searchParams.get('manual') === '1';
	const openPinIdFromQuery = String(searchParams.get('pinId') || '').trim();
	const { connected: destinationConnected, refresh: refreshDestination } = useDestinationConnected(destination);
	const pinterestConnected = destinationConnected;
	const refreshPinterest = refreshDestination;
	const {
		websites,
		websiteId,
		setWebsiteId,
		loading: loadingWebsites,
		error: websitesError,
		isSelectionValid,
	} = useWorkspaceWebsites({ preferredId: preferredWebsiteId });
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
	const [loadingArticles, setLoadingArticles] = useState(false);
	const [loadingPins, setLoadingPins] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [loadingAccounts, setLoadingAccounts] = useState(false);
	const [loadingBoards, setLoadingBoards] = useState(false);
	const [editingPinId, setEditingPinId] = useState('');
	const [savedPins, setSavedPins] = useState([]);
	const [selectedTemplateId, setSelectedTemplateId] = useState(
		() => readPersistedGalleryTemplateSelection()?.id || '',
	);
	const [gallerySelectionActive, setGallerySelectionActive] = useState(
		() => Boolean(readPersistedGalleryTemplateSelection()?.id),
	);
	const [hydratedTemplate, setHydratedTemplate] = useState(null);
	const [templateHydrationError, setTemplateHydrationError] = useState('');
	const [templateHydrating, setTemplateHydrating] = useState(false);
	const [templateChooserOpen, setTemplateChooserOpen] = useState(false);
	const [upgradeModal, setUpgradeModal] = useState(null);
	const [originalTemplateUnavailable, setOriginalTemplateUnavailable] = useState(false);
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
		imageMode: 'generate_ai',
		style: '',
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
	const [aspectRatio, setAspectRatio] = useState(() => studioAssets.defaultAspectRatioId);
	const selectedExportProfileId = useMemo(
		() => studioAssets.resolveExportProfileIdForAspect(aspectRatio),
		[studioAssets, aspectRatio],
	);
	const inspectorPreviewAspectClass = useMemo(
		() => studioAssets.resolvePreviewAspectClass(aspectRatio),
		[studioAssets, aspectRatio],
	);
	const [imageType, setImageType] = useState('pin');
	const [promptOnlyText, setPromptOnlyText] = useState('');
	const [referenceImages, setReferenceImages] = useState([]);
	const [loadingReferenceImages, setLoadingReferenceImages] = useState(false);
	const [uploadingReferenceImages, setUploadingReferenceImages] = useState(false);
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
	const previewImageGenerationEpochRef = useRef(0);

	const publishingConfig = useMemo(() => resolvePublishingConfig(config), [config]);
	const templates = useMemo(() => mapStudioTemplates(config), [config]);
	const brandKits = useMemo(() => mapStudioBrandKits(config), [config]);
	const pinStyles = useMemo(() => mapStudioPinStyles(config), [config]);
	const credits = useMemo(() => mapStudioCredits(config), [config]);
	const imageQualities = useMemo(() => buildImageQualityOptions(config), [config]);
	const pinCounts = useMemo(() => buildPinCountOptions(config), [config]);
	const showBrandKit = isFeatureEnabled('brand-kit', true);
	const showTemplates = isFeatureEnabled('templates', true);
	const showHistory = isFeatureEnabled('history', true);
	const showAiImages = isFeatureEnabled('ai-images', true);
	const showPinterest = isFeatureEnabled(product.featureFlag, true);

	useEffect(() => {
		if (!hasValidConfig || defaultsAppliedRef.current) return;
		defaultsAppliedRef.current = true;

		const defaultQualityId = resolveDefaultImageQualityId(config);
		const defaultQuality = imageQualities.find((item) => item.id === defaultQualityId) || imageQualities[0];
		const styles = mapStudioPinStyles(config);
		const recipeStyle = String(config?.content?.recipeStyle || '').trim();
		const defaultTone = String(config?.content?.defaultPinTone || recipeStyle || '').trim();
		const defaultAudience = String(config?.content?.defaultPinAudience || '').trim();

		setTimezone((prev) => prev || config?.schedulingDefaults?.timezone || config?.general?.timezone || 'UTC');
		setAspectRatio(studioAssets.defaultAspectRatioId);
		setImageQuality(defaultQualityId);
		setPanel((prev) => ({
			...prev,
			language: prev.language || languageLabelFromConfig(config),
			toneOfVoice: prev.toneOfVoice || defaultTone,
			targetAudience: prev.targetAudience || defaultAudience,
			style: prev.style || styles[0] || '',
			imageMode: defaultQuality?.imageMode || prev.imageMode,
			count: pinCounts.includes(prev.count) ? prev.count : (pinCounts[1] || pinCounts[0] || 1),
		}));

		const defaultTemplate = templates.find((item) => item.isDefault) || templates[0];
		if (defaultTemplate) setSelectedTemplateId((prev) => prev || defaultTemplate.id);
		const defaultKit = brandKits.find((item) => item.isDefault) || brandKits[0];
		if (defaultKit) setSelectedBrandKitId((prev) => prev || defaultKit.id);
	}, [hasValidConfig, config, imageQualities, pinCounts, templates, brandKits, studioAssets.defaultAspectRatioId]);

	useEffect(() => {
		setAspectRatio(studioAssets.defaultAspectRatioId);
	}, [product.destinationId, studioAssets.defaultAspectRatioId]);

	useEffect(() => {
		// Sync the safe image mode default only when workspace config version changes.
		// Do not depend on panel.* or this effect will loop (Maximum update depth → blank page).
		if (!hasValidConfig || imageQualities.length === 0) {
			return;
		}
		const next = resolveDefaultImageQualityId(config, imageQualities);
		const quality = imageQualities.find((item) => item.id === next) || imageQualities[0];
		if (!quality) {
			return;
		}
		setImageQuality((prev) => (prev === quality.id ? prev : quality.id));
		setPanel((prev) => {
			if (prev.imageMode === quality.imageMode) {
				return prev;
			}
			return {
				...prev,
				imageMode: quality.imageMode || 'generate_ai',
			};
		});
	}, [configVersion, hasValidConfig, imageQualities, config]);

	useEffect(() => {
		// Gallery-selected templates may not appear in workspace studio list — never wipe them.
		if (
			!gallerySelectionActive
			&& selectedTemplateId
			&& templates.length > 0
			&& !templates.some((item) => item.id === selectedTemplateId)
		) {
			const fallback = templates.find((item) => item.isDefault) || templates[0];
			setSelectedTemplateId(fallback?.id || '');
		}
		if (selectedBrandKitId && brandKits.length > 0 && !brandKits.some((item) => item.id === selectedBrandKitId)) {
			const fallback = brandKits.find((item) => item.isDefault) || brandKits[0];
			setSelectedBrandKitId(fallback?.id || '');
		}
		if (panel.style && pinStyles.length > 0 && !pinStyles.includes(panel.style)) {
			setPanel((prev) => (
				prev.style === pinStyles[0] ? prev : { ...prev, style: pinStyles[0] || '' }
			));
		}
	}, [templates, selectedTemplateId, gallerySelectionActive, brandKits, selectedBrandKitId, pinStyles, panel.style]);

	useEffect(() => {
		const persisted = readPersistedGalleryTemplateSelection();
		if (!persisted?.id) return undefined;
		let cancelled = false;
		setGallerySelectionActive(true);
		setSelectedTemplateId(persisted.id);
		setTemplateHydrating(true);
		setTemplateHydrationError('');
		(async () => {
			try {
				const full = await fetchTemplateCached(persisted.id);
				if (cancelled) return;
				if (!full?.configuration) {
					throw new Error('Selected template configuration is missing.');
				}
				setHydratedTemplate(full);
			} catch (error) {
				if (cancelled) return;
				setTemplateHydrationError(error?.message || 'Failed to load selected template');
				// Keep selection id — do not clear articles/pins or fall back silently.
			} finally {
				if (!cancelled) setTemplateHydrating(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

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

	const selectedTemplate = useMemo(() => {
		if (gallerySelectionActive && hydratedTemplate?.id === selectedTemplateId) {
			return hydratedTemplate;
		}
		return templates.find((template) => template.id === selectedTemplateId) || null;
	}, [gallerySelectionActive, hydratedTemplate, templates, selectedTemplateId]);

	const templateStepPreview = useMemo(() => {
		if (!selectedTemplate) {
			return { url: '', fromCache: false };
		}
		const resolved = resolveGalleryThumbnail(selectedTemplate);
		if (resolved.url) return resolved;
		return {
			url: selectedTemplate.thumbnailUrl
				|| selectedTemplate.thumbnail
				|| selectedTemplate.previewUrl
				|| selectedTemplate.templateThumbnail
				|| '',
			fromCache: false,
		};
	}, [selectedTemplate]);

	const templateStepPremium = useMemo(
		() => (selectedTemplate ? isPremiumGalleryTemplate(selectedTemplate) : false),
		[selectedTemplate],
	);

	// Restore Step 2 card from draft snapshot (historical SoT). Soft-check live template only for unavailable label.
	useEffect(() => {
		if (!editingPinId) return undefined;
		const pin = savedPins.find((item) => item.id === editingPinId);
		if (!pin || (!pin.templateConfig && !pin.templateId)) return undefined;

		const snapshotHydrated = {
			id: pin.templateId || '',
			name: pin.templateName || 'Pin Layout',
			configuration: pin.templateConfig || null,
			thumbnail: pin.templateThumbnail || '',
			thumbnailUrl: pin.templateThumbnail || '',
			previewUrl: pin.templateThumbnail || '',
			fromDraftSnapshot: true,
		};
		setHydratedTemplate(snapshotHydrated);
		if (pin.templateId) {
			setSelectedTemplateId(pin.templateId);
			setGallerySelectionActive(true);
			persistGalleryTemplateSelection({ id: pin.templateId, source: 'gallery' });
		}
		setOriginalTemplateUnavailable(false);

		if (!pin.templateId) return undefined;
		let cancelled = false;
		fetchTemplateCached(pin.templateId)
			.then(() => {
				if (!cancelled) setOriginalTemplateUnavailable(false);
			})
			.catch(() => {
				// Keep stored snapshot — never invalidate the draft.
				if (!cancelled) setOriginalTemplateUnavailable(true);
			});
		return () => {
			cancelled = true;
		};
	}, [editingPinId, savedPins]);

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

	const facebookPageName = useMemo(() => {
		if (!isFacebookStudio) return L.previewDefaultPageName;
		const board = boards.find((item) => item.boardId === selectedBoardId);
		if (board?.name) return board.name;
		const account = accounts.find((item) => item.id === selectedAccountId);
		return account?.label || account?.accountName || account?.username || L.previewDefaultPageName;
	}, [isFacebookStudio, boards, selectedBoardId, accounts, selectedAccountId, L.previewDefaultPageName]);

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

	const loadArticles = async () => {
		if (!isSelectionValid) {
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
		if (!isSelectionValid) {
			setSavedPins([]);
			return;
		}

		setLoadingPins(true);
		try {
			const response = await apiServerClient.fetch(
				`/ai-pins/pins?websiteId=${encodeURIComponent(websiteId)}`,
				{ method: 'GET' },
			);
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to load pins (${response.status})`);
			}
			const pins = Array.isArray(payload.items) ? payload.items : [];
			const mappedPins = pins.map(mapSavedPin);

			for (const pin of mappedPins) {
				const previousStatus = previousStatusesRef.current.get(pin.id);
				if (previousStatus && previousStatus !== pin.status) {
					if (pin.status === 'published') {
						toast({
							title: 'Publish successful',
							description: `${L.publishedItem}: ${pin.title}. Next: open Analytics to measure performance.`,
						});
					}
					if (pin.status === 'failed') {
						toast({ variant: 'destructive', title: 'Publish failed', description: pin.publishError || `${L.failedItem}: ${pin.title}` });
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
			const { items, unavailable, message } = await destination.listDestinations(selectedAccountId);
			if (unavailable) {
				setBoards([]);
				setSelectedBoardId('');
				toast({
					variant: 'destructive',
					title: L.accountUnavailableTitle,
					description: message || L.accountUnavailableBody,
				});
				return;
			}
			setBoards(items);
			if (items.length > 0) {
				const preferredBoard = items.find((board) => board.isDefault) || items[0];
				setSelectedBoardId((prev) => {
					if (prev && items.some((board) => board.boardId === prev)) {
						return prev;
					}
					return preferredBoard.boardId;
				});
			}
			setBoardsByAccount((prev) => ({
				...prev,
				[selectedAccountId]: items,
			}));
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message || L.loadDestinationsFailed });
		} finally {
			setLoadingBoards(false);
		}
	};

	const loadAccounts = async () => {
		setLoadingAccounts(true);
		try {
			const items = await destination.listAccounts();
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
			toast({ variant: 'destructive', title: 'Error', description: error.message || L.loadAccountsFailed });
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
				body: JSON.stringify({ articleId: activeArticle.id, style: panel.style, channel: studioChannel }),
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
			toast({ title: 'Article analyzed', description: L.analyzeDone });
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
					channel: studioChannel,
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
		loadAccounts();
		loadReferenceImages();
	}, []);

	useEffect(() => {
		if (!websitesError) return;
		toast({ variant: 'destructive', title: 'Error', description: websitesError });
	}, [websitesError]);

	useEffect(() => {
		if (openManualFromQuery && websiteId) {
			setManualOpen(true);
		}
	}, [openManualFromQuery, websiteId]);

	// Calendar / deep-link: open the originating Studio pin when pinId is present.
	useEffect(() => {
		if (!openPinIdFromQuery || loadingPins) return;
		const exists = savedPins.some((pin) => pin.id === openPinIdFromQuery);
		if (!exists) return;
		setEditingPinId(openPinIdFromQuery);
		setSelectedPreviewTempId('');
	}, [openPinIdFromQuery, savedPins, loadingPins]);

	// Website Articles / deep-link: pre-select article when articleId is present.
	useEffect(() => {
		if (!preferredArticleId || articleIdFromQueryAppliedRef.current || loadingArticles) return;
		if (!articles.some((article) => article.id === preferredArticleId)) return;
		setActiveArticleId(preferredArticleId);
		setCreateMode('single');
		articleIdFromQueryAppliedRef.current = true;
	}, [preferredArticleId, articles, loadingArticles]);

	useEffect(() => {
		loadBoards();
	}, [selectedAccountId]);

	useEffect(() => {
		if (loadingWebsites) return;
		setArticlePage(1);
		loadArticles();
		loadPins();
	}, [websiteId, isSelectionValid, loadingWebsites]);

	useEffect(() => {
		if (!hasValidConfig) return;
		const nextTz = publishingConfig.timezone;
		if (nextTz) setTimezone(nextTz);
	}, [hasValidConfig, publishingConfig.timezone, configVersion]);

	useEffect(() => {
		if (!isSelectionValid) {
			return;
		}

		const interval = setInterval(() => {
			loadPins();
		}, 20000);

		return () => clearInterval(interval);
	}, [websiteId, isSelectionValid]);

	useEffect(() => {
		if (!isSelectionValid || loadingWebsites) return;
		loadArticles();
	}, [articlePage, articleStatus, articleCategory, isSelectionValid, loadingWebsites]);

	useEffect(() => {
		if (!isSelectionValid || loadingWebsites) return;
		const timeout = setTimeout(() => {
			setArticlePage(1);
			loadArticles();
		}, 250);

		return () => clearTimeout(timeout);
	}, [articleSearch, isSelectionValid, loadingWebsites]);

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
		if (selectedDraftPins.length > 0) return selectedDraftPins;
		if (editingPinId) {
			const openPin = savedPins.find((pin) => pin.id === editingPinId);
			if (openPin && (openPin.status === 'draft' || openPin.status === 'failed')) {
				return [openPin];
			}
		}
		return [];
	};

	const resolvePublishTargets = (pins = []) => {
		const accountId = selectedAccountId
			|| pins.find((pin) => pin.accountId)?.accountId
			|| '';
		const boardId = selectedBoardId
			|| pins.find((pin) => pin.boardId)?.boardId
			|| '';
		return { accountId, boardId };
	};

	const assertPublishTargets = (pins, accountId, boardId) => {
		if (!pins.length) throw new Error(`Choose one or more draft ${L.itemLowerPlural} first.`);
		if (!accountId) throw new Error(L.chooseAccount);
		if (!boardId) throw new Error(L.chooseDestination);
		const account = accounts.find((item) => item.id === accountId);
		if (!account) throw new Error(L.accountNotFound);
		const disconnected = account.connected === false
			|| ['disconnected', 'error', 'expired'].includes(String(account.status || '').toLowerCase());
		if (disconnected) {
			throw new Error(L.accountNotConnected);
		}
		const notDraft = pins.find((pin) => pin.status && !['draft', 'failed'].includes(pin.status));
		if (notDraft) throw new Error(`${L.itemSingular} "${notDraft.title || notDraft.id}" must be a draft (or failed) to publish.`);

		for (const pin of pins) {
			traceSourceUrl('6_publish_dialog_validate', {
				sourceUrl: pin.sourceUrl || pin.source_url || pin.articleUrl || pin.destinationUrl || '',
				pinId: pin.id,
				articleId: pin.articleId,
				file: 'apps/web/src/pages/app/ContentStudioPage.jsx',
				functionName: 'assertPublishTargets',
				lineNumber: 927,
			});
			const check = destination.validateItem(pin);
			if (!check.ok) {
				throw new Error(`${L.itemSingular} "${pin.title || pin.id}": ${check.errors.join('. ')}`);
			}
			traceSourceUrl('7_publish_request_ready', {
				sourceUrl: check.destinationUrl,
				pinId: pin.id,
				articleId: pin.articleId,
				file: 'apps/web/src/pages/app/ContentStudioPage.jsx',
				functionName: 'assertPublishTargets',
				lineNumber: 937,
			});
		}
	};

	const preparePinsForPublish = async (pins) => {
		const list = Array.isArray(pins) ? pins : [];
		if (list.length === 0) return [];
		const repaired = await ensurePinsSourceUrl(list.map((pin) => pin.id));
		const byId = new Map(repaired.map((pin) => [pin.id, pin]));
		const merged = list.map((pin) => {
			const next = byId.get(pin.id);
			return next ? { ...pin, ...next } : pin;
		});
		setSavedPins((prev) => prev.map((pin) => {
			const next = byId.get(pin.id);
			return next ? { ...pin, ...next } : pin;
		}));
		return merged;
	};

	const handleStudioTemplateChange = (nextId) => {
		setSelectedTemplateId(nextId);
		setGallerySelectionActive(false);
		setHydratedTemplate(null);
		setTemplateHydrationError('');
		setOriginalTemplateUnavailable(false);
		clearPersistedGalleryTemplateSelection();
	};

	const selectGalleryTemplate = async (summary) => {
		const id = String(summary?.id || '').trim();
		if (!id) return;

		// Backend access object is the only lock authority — never infer from premium/tier.
		if (isTemplateAccessLocked(summary)) {
			trackProductEvent(
				PRODUCT_EVENTS.TEMPLATE_LOCKED_CLICK,
				buildTemplateEventProps(summary, { sourcePage: 'ai_pins_chooser' }),
				{ dedupeKey: `template_locked_click:ai_pins_chooser:${id}` },
			);
			setTemplateChooserOpen(false);
			setUpgradeModal({
				templateId: id,
				templateName: summary?.name || 'Template',
				access: getTemplateAccess(summary),
				requiredFeatureKeys: summary?.requiredFeatureKeys,
				sourcePage: 'ai_pins_chooser',
			});
			return;
		}

		// Keep prior selection until success/failure settles — never wipe articles/pins.
		setTemplateChooserOpen(false);
		setGallerySelectionActive(true);
		setSelectedTemplateId(id);
		persistGalleryTemplateSelection({ id, source: 'gallery' });
		setTemplateHydrating(true);
		setTemplateHydrationError('');
		setOriginalTemplateUnavailable(false);

		try {
			const full = await fetchTemplateCached(id);
			if (isTemplateAccessLocked(full)) {
				trackProductEvent(
					PRODUCT_EVENTS.TEMPLATE_LOCKED_CLICK,
					buildTemplateEventProps(full, { sourcePage: 'ai_pins_chooser' }),
					{ dedupeKey: `template_locked_click:ai_pins_chooser:${id}` },
				);
				setUpgradeModal({
					templateId: id,
					templateName: full?.name || summary?.name || 'Template',
					access: getTemplateAccess(full),
					requiredFeatureKeys: full?.requiredFeatureKeys,
					sourcePage: 'ai_pins_chooser',
				});
				setTemplateHydrationError('');
				return;
			}
			if (!full?.configuration) {
				throw new Error('Template configuration is missing.');
			}
			setHydratedTemplate(full);
			trackProductEvent(
				PRODUCT_EVENTS.TEMPLATE_USED,
				buildTemplateEventProps(full, { sourcePage: 'ai_pins_chooser' }),
				{ dedupeKey: `template_used:ai_pins_chooser:${id}` },
			);
			toast({
				title: 'Template selected',
				description: full.name || summary?.name || 'Gallery template ready for generation.',
			});
		} catch (error) {
			setTemplateHydrationError(error?.message || 'Failed to load template');
			toast({
				variant: 'destructive',
				title: 'Template load failed',
				description: error?.message || 'Could not load the selected template. Generation will not fall back to the default.',
			});
		} finally {
			setTemplateHydrating(false);
		}
	};

	const handleChooseDesignLibraryTemplate = () => {
		const bridge = openDesignLibraryChooser({
			onSelect: (template) => {
				if (template?.id) void selectGalleryTemplate(template);
			},
		});
		if (bridge.available) {
			setTemplateChooserOpen(true);
			return;
		}
		toast({
			title: 'Design Library',
			description: bridge.message || 'Template gallery is unavailable.',
		});
	};

	const startPreviewImageGeneration = async (
		pins,
		brandKit = null,
	) => {
		if (!Array.isArray(pins) || pins.length === 0) {
			return;
		}

		const epoch = previewImageGenerationEpochRef.current + 1;
		previewImageGenerationEpochRef.current = epoch;
		const isCancelled = () => previewImageGenerationEpochRef.current !== epoch;

		setGeneratingImages(true);
		try {
			const { pinPatches, pollTimedOut } = await runPreviewImagePipeline({
				fetchFn: (url, options) => apiServerClient.fetch(url, options),
				pins,
				brandKit,
				channel: studioChannel,
				exportProfileId: selectedExportProfileId,
				isCancelled,
				onJobsUpdate: (jobs) => {
					if (isCancelled()) {
						return;
					}
					setGeneratedPreviewPins((prev) => prev.map((pin) => {
						const job = jobs.find((item) => item.clientToken === pin.tempId || item.id === pin.imageJobId);
						return job ? mapPollJobToPinPatch(pin, job) : pin;
					}));
				},
			});

			if (isCancelled()) {
				return;
			}

			if (pollTimedOut) {
				toast({
					variant: 'destructive',
					title: 'Image generation timed out',
					description: 'Studio stopped waiting. Article images are used when available; use Retry on individual pins if needed.',
				});
			}

			if (pinPatches.length > 0) {
				const patchByTempId = new Map(pinPatches.map((item) => [item.tempId, item.patch]));
				setGeneratedPreviewPins((prev) => prev.map((pin) => {
					const patch = patchByTempId.get(pin.tempId);
					return patch ? { ...pin, ...patch } : pin;
				}));
			}
		} catch (error) {
			if (isCancelled()) {
				return;
			}
			console.error('[AI Pins] image workflow failed', error);
			const lastResort = await runLastResortArticleCompose({
				pins,
				brandKit,
				exportProfileId: selectedExportProfileId,
			}).catch(() => null);
			if (lastResort?.length) {
				applyTemplateComposeResults(lastResort, { imageSource: 'featured_fallback' });
				toast({
					title: 'Used article images',
					description: 'AI image generation was unavailable. Pins were composed with article images and your selected template.',
				});
				return;
			}
			setGeneratedPreviewPins((prev) => prev.map((pin) => ({
				...pin,
				imageUrl: pin.imageUrl || '',
				imageGenerationStatus: pin.imageUrl ? pin.imageGenerationStatus : 'failed',
				imageGenerationError: pin.imageUrl
					? pin.imageGenerationError
					: (error?.message || 'Image workflow failed'),
			})));
		} finally {
			if (!isCancelled()) {
				setGeneratingImages(false);
			}
		}
	};

	const applyTemplateComposeResults = (composed, { imageSource = 'featured_composed' } = {}) => {
		setGeneratedPreviewPins((prev) => prev.map((pin) => {
			const result = composed.find((item) => item.tempId === pin.tempId);
			if (!result) {
				return pin;
			}
			if (!result.ok || !result.imageUrl) {
				traceImageLifecycle('10_react_state_update', {
					traceId: pin.tempId,
					tempId: pin.tempId,
					success: false,
					error: result.error || 'Template compose failed',
					imageUrl: '',
					functionName: 'applyTemplateComposeResults',
					fileName: 'apps/web/src/pages/app/AIPinsPage.jsx',
					lineNumber: 1114,
					meta: {
						previousImageUrl: pin.imageUrl || '',
						previousFeaturedImage: pin.featuredImage || '',
						replacement: 'cleared imageUrl; UI leaves TemplatePreviewCard only if status not failed',
					},
				});
				return {
					...pin,
					imageUrl: '',
					imageGenerationStatus: 'failed',
					imageGenerationError: result.error || 'Template compose failed',
				};
			}
			traceImageLifecycle('10_react_state_update', {
				traceId: pin.tempId,
				tempId: pin.tempId,
				imageUrl: result.imageUrl,
				functionName: 'applyTemplateComposeResults',
				fileName: 'apps/web/src/pages/app/AIPinsPage.jsx',
				lineNumber: 1135,
				meta: {
					previousImageUrl: pin.imageUrl || '',
					previousFeaturedImage: pin.featuredImage || '',
					newImageUrl: result.imageUrl,
					note: 'THIS assignment swaps TemplatePreviewCard(article image) for <img src=imageUrl>. If imageUrl is a blank JPEG, the article photo disappears here.',
					uiLine: 'AIPinsPage.jsx ~2682 {pin.imageUrl ? <img src={pin.imageUrl} /> : <TemplatePreviewCard featuredImageUrl={pin.featuredImage} />}',
				},
			});
			return {
				...pin,
				imageUrl: result.imageUrl,
				imageSource: result.imageSource || imageSource,
				generationMeta: withUpdatedImageSourceMeta(
					pin.generationMeta || {
						copySource: pin.copySource,
						imageSource: pin.generationMeta?.imageSource,
						fallbackReason: pin.fallbackReason,
					},
					result.imageSource || imageSource,
				),
				imageGenerationStatus: 'completed',
				imageGenerationError: result.hosted === false ? (result.error || '') : '',
			};
		}));
	};

	const resolveArticleImagesForTargets = async (targets) => {
		const websiteKey = String(websiteId || targets[0]?.websiteId || '').trim();
		const ids = targets.map((item) => item.id).filter(Boolean);
		if (!websiteKey || ids.length === 0) {
			return new Map();
		}

		try {
			const response = await apiServerClient.fetch(
				`/websites/${encodeURIComponent(websiteKey)}/articles/resolve-images`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ articleIds: ids, persist: true }),
				},
			);
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || 'Failed to resolve article images');
			}
			const map = new Map();
			for (const item of Array.isArray(payload.items) ? payload.items : []) {
				map.set(item.articleId, item);
				traceImageLifecycle('1_article_discovery_resolve', {
					traceId: item.articleId,
					articleId: item.articleId,
					imageUrl: item.resolvedImage || item.featuredImage || '',
					functionName: 'resolveArticleImagesForTargets',
					fileName: 'apps/web/src/pages/app/AIPinsPage.jsx',
					meta: {
						source: item.source,
						contentImageCount: Array.isArray(item.contentImages) ? item.contentImages.length : 0,
					},
				});
			}
			return map;
		} catch (error) {
			console.warn('[AI Pins] resolve-images failed; using stored featured images', error);
			return new Map();
		}
	};

	const generatePinsForArticle = async (article, count, panelOverride = panel) => {
		return resolveStudioPinCopy({
			imageMode: panelOverride?.imageMode,
			article,
			count,
			panel: panelOverride,
			analysis,
			generateText,
			buildPrompt: () => buildPinPromptFromConfig({
				config,
				article,
				count,
				panel: panelOverride,
				channel: studioChannel,
			}),
			parsePins: parsePinsFromText,
		});
	};

	const handleGenerate = async () => {
		if (!websiteId) {
			toast({ variant: 'destructive', title: 'Select website', description: 'Please select a website first.' });
			return;
		}

		const quality = imageQualities.find((item) => item.id === imageQuality) || imageQualities[0];
		const ratio = studioAssets.aspectRatios.find((item) => item.id === aspectRatio);
		const websiteLabel = activeWebsite?.domain || activeWebsite?.url || activeWebsite?.name || '';
		const imageSourceStrategy = normalizeImageSourceStrategy(config?.images?.imageSourceStrategy);

		let workingPanel = {
			...panel,
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
		setBulkProgress({ active: true, current: 0, total: targets.length, message: 'Resolving article images...' });
		try {
			const resolvedImages = await resolveArticleImagesForTargets(targets);
			targets = targets.map((article) => {
				const resolved = resolvedImages.get(article.id);
				const nextFeatured = String(resolved?.resolvedImage || article.featuredImage || '').trim();
				return {
					...article,
					featuredImage: nextFeatured,
					contentImages: Array.isArray(resolved?.contentImages) ? resolved.contentImages : [],
				};
			});

			if (imageSourceStrategy === IMAGE_SOURCE_STRATEGY.ALWAYS_FEATURED) {
				const missing = targets.filter((article) => !pickArticleImageUrl(article));
				if (missing.length > 0) {
					toast({
						variant: 'destructive',
						title: 'Article image required',
						description: `${missing.length} article(s) have no featured or content image. Always Featured Image requires an article image for AI fallback.`,
					});
					return;
				}
			}

			const generatedRecords = [];
			let usedLocalTextFallback = false;
			let localTextFallbackReason = '';
			const activeAccount = accounts.find((account) => account.id === selectedAccountId);
			const activeBoard = boards.find((board) => board.boardId === selectedBoardId);
			const resolvedTemplate = resolveGenerateTemplate({
				gallerySelectionActive,
				hydratedTemplate,
				hydrationError: templateHydrationError,
				studioTemplate: gallerySelectionActive ? null : selectedTemplate,
			});
			const templateConfig = resolvedTemplate.configuration;
			const templateThumb = resolveGalleryThumbnail(hydratedTemplate || selectedTemplate || {}).url
				|| hydratedTemplate?.thumbnail
				|| hydratedTemplate?.thumbnailUrl
				|| hydratedTemplate?.previewUrl
				|| selectedTemplate?.thumbnailUrl
				|| '';
			const templateVersion = formatTemplateVersionSnapshot({
				revision: hydratedTemplate?.revision,
				editorVersion: hydratedTemplate?.editorVersion,
				schemaVersion: hydratedTemplate?.schemaVersion,
				configChecksum: hydratedTemplate?.configChecksum || hydratedTemplate?.config_checksum,
			});
			const templateSnapshotAt = new Date().toISOString();
			const selectedBrand = brandKits.find((item) => item.id === selectedBrandKitId) || null;
			for (let articleIndex = 0; articleIndex < targets.length; articleIndex += 1) {
				const article = targets[articleIndex];
				traceSourceUrl('1_selected_article', {
					sourceUrl: article.url || '',
					articleId: article.id,
					file: 'apps/web/src/pages/app/AIPinsPage.jsx',
					functionName: 'handleGenerate',
					lineNumber: 1534,
					meta: { title: article.title || article.slug || '' },
				});
				const resolved = resolvedImages.get(article.id);
				const sourceImageUrl = pickArticleImageUrl(article);
				const articleUrl = normalizeDestinationUrl(article.url || '');
				if (!articleUrl) {
					throw new Error(
						`Article "${article.title || article.slug || article.id}" is missing a valid http(s) URL. `
						+ L.missingLink,
					);
				}
				const imagePlan = planImageSource({
					strategy: imageSourceStrategy,
					articleImageUrl: sourceImageUrl,
				});
				const fallbackImageOrigin = String(resolved?.source || '') === 'body' ? 'body' : 'featured';
				const articlePanel = {
					...workingPanel,
					imageMode: 'generate_ai',
				};

				setBulkProgress({
					active: true,
					current: articleIndex + 1,
					total: targets.length,
					message: `Generating pins for ${article.title || article.slug || 'article'}...`,
				});
				const copyResult = await generatePinsForArticle(article, workingPanel.count, articlePanel);
				const generatedPins = Array.isArray(copyResult?.pins) ? copyResult.pins : [];
				const copyMeta = copyResult?.meta || {
					copySource: copyResult?.copySource || '',
					imageSource: copyResult?.imageSource || (imagePlan.useAi ? 'ai' : 'featured'),
					fallbackReason: copyResult?.fallbackReason ?? null,
				};
				if (copyMeta.copySource === PIN_COPY_SOURCE.LOCAL_TEXT_FALLBACK) {
					usedLocalTextFallback = true;
					localTextFallbackReason = copyMeta.fallbackReason || localTextFallbackReason;
				}
				const siteMeta = websites.find((site) => site.id === article.websiteId);
				const websiteLabelForPin = selectedBrand?.websiteUrl
					|| siteMeta?.domain
					|| siteMeta?.url
					|| siteMeta?.name
					|| '';
				const useExplicitGalleryTemplate = resolvedTemplate.source === 'gallery';
				const styledPins = assignIntelligentPinDesigns(
					generatedPins.map((pin) => ({
						...pin,
						category: article.category || analysis?.pinterestCategory || '',
					})),
					{
						article,
						analysis,
						panel: articlePanel,
						respectExplicitTemplate: useExplicitGalleryTemplate,
						explicitTemplate: useExplicitGalleryTemplate ? resolvedTemplate : null,
					},
				);
				generatedRecords.push(
					...styledPins.map((pin, index) => {
						const record = {
						tempId: `${article.id}-${Date.now()}-${index}`,
						articleId: article.id,
						websiteId: article.websiteId,
						title: String(pin.title || analysis?.title || article.title || article.slug || L.draftTitleFallback).trim(),
						subtitle: String(pin.subtitle || '').trim(),
						description: String(pin.description || analysis?.seoDescription || workingPanel.pinDescription || '').trim(),
						overlayText: String(pin.overlayText || analysis?.cta || workingPanel.textOverlay || '').trim(),
						imagePrompt: String(pin.imagePrompt || '').trim(),
						imageUrl: '',
						suggestedKeywords: safeArray(pin.suggestedKeywords?.length ? pin.suggestedKeywords : analysis?.keywords),
						suggestedHashtags: safeArray(pin.suggestedHashtags?.length ? pin.suggestedHashtags : analysis?.hashtags),
						accountId: selectedAccountId,
						accountLabel: activeAccount?.label || activeAccount?.accountName || activeAccount?.username || '',
						boardId: selectedBoardId,
						boardName: activeBoard?.name || '',
						templateId: resolvedTemplate.id || '',
						templateName: useExplicitGalleryTemplate
							? (resolvedTemplate.name || 'Selected template')
							: (pin.layoutLabel || pin.recipeFamilyLabel || resolvedTemplate.name || 'Pin Layout'),
						templateVersion,
						templateThumbnail: templateThumb,
						templateSnapshotAt,
						layoutId: pin.layoutId || '',
						layoutLabel: pin.layoutLabel || '',
						recipeFamily: pin.recipeFamily || '',
						designRecommendation: pin.designRecommendation || null,
						templateConfig: applyIntelligentTemplateConfig(
							templateConfig,
							useExplicitGalleryTemplate ? null : pin.designRecommendation,
							{
								brandKit: selectedBrand,
								respectExplicitTemplate: useExplicitGalleryTemplate,
							},
						),
						category: article.category || analysis?.pinterestCategory || '',
						website: websiteLabelForPin,
						author: article.author,
						featuredImage: sourceImageUrl || article.featuredImage || '',
						sourceImageUrl: sourceImageUrl || '',
						contentImages: Array.isArray(article.contentImages) ? article.contentImages : [],
						sourceUrl: articleUrl,
						articleUrl,
						destinationUrl: articleUrl,
						imageOrigin: 'ai',
						fallbackImageOrigin,
						// Operational persistence value (draft/API). Analytics kind lives on generationMeta.imageSource.
						imageSource: 'ai_generated',
						copySource: copyMeta.copySource,
						fallbackReason: copyMeta.fallbackReason,
						generationMeta: {
							copySource: copyMeta.copySource,
							imageSource: copyMeta.imageSource,
							fallbackReason: copyMeta.fallbackReason,
						},
						imageGenerationStatus: 'processing',
						imageGenerationError: '',
						imageJobId: '',
						imageMode: 'generate_ai',
						imagePlan,
						imageSourceStrategy,
						style: workingPanel.style,
						cta: analysis?.cta || '',
						analysis: analysis || null,
						brandKitId: selectedBrandKitId || '',
						};
						traceSourceUrl('2_generated_pin_object', {
							sourceUrl: record.sourceUrl,
							tempId: record.tempId,
							articleId: record.articleId,
							file: 'apps/web/src/pages/app/AIPinsPage.jsx',
							functionName: 'handleGenerate',
							lineNumber: 1620,
						});
						return record;
					})
				);
			}

			setGeneratedPreviewPins(generatedRecords);
			setSelectedPreviewTempId(generatedRecords[0]?.tempId || '');
			setEditingPinId('');
			setPanel((prev) => ({
				...prev,
				imageMode: 'generate_ai',
			}));
			if (gallerySelectionActive || selectedTemplateId) {
				trackProductEvent(
					PRODUCT_EVENTS.TEMPLATE_GENERATED,
					buildTemplateEventProps(hydratedTemplate || { id: selectedTemplateId }, {
						sourcePage: 'ai_pins',
						templateId: selectedTemplateId || hydratedTemplate?.id,
						templateName: hydratedTemplate?.name,
					}),
					{ dedupe: false },
				);
			}
			if (usedLocalTextFallback) {
				toast({
					title: 'Using local pin copy',
					description: localTextFallbackReason
						? 'AI generation is temporarily unavailable. Pin copy was generated from the article; images are generating in the background.'
						: 'AI generation is temporarily unavailable. Pin copy was generated from the article; images are generating in the background.',
				});
			} else {
				toast({
					title: 'Preview ready',
					description: 'Pin copy is ready. AI images are generating in the background; article images are used automatically if AI fails.',
				});
			}
			void startPreviewImageGeneration(
				generatedRecords,
				selectedBrand,
			);
		} catch (error) {
			toast({
				variant: 'destructive',
				title: 'Generation failed',
				description: 'AI generation is unavailable right now. Please try again later.',
			});
		} finally {
			setGenerating(false);
			setBulkProgress({ active: false, current: 0, total: 0, message: '' });
			await refreshWorkspaceConfig();
		}
	};

	const regeneratePreviewImage = async (pin) => {
		try {
			setGeneratingImages(true);
			const brandKit = brandKits.find((item) => item.id === selectedBrandKitId) || null;
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
				? { ...item, imageJobId: job.id, imageGenerationStatus: 'queued', imageGenerationError: '', imageUrl: '' }
				: item));

			const { jobs: finishedJobs, pollTimedOut } = await pollPreviewImageJobs({
				fetchFn: (url, options) => apiServerClient.fetch(url, options),
				jobIds: [job.id],
			});
			const finished = finishedJobs.find((item) => item.id === job.id) || job;
			const resolved = resolvePinBackgroundFromJob({ pin, job: finished, pollTimedOut });
			if (!resolved.background) {
				throw new Error(resolved.aiError || finished.lastError || 'AI image generation failed and no article image was available.');
			}
			const composed = await composeAndUploadFeaturedPins([{
				...pin,
				featuredImage: resolved.background,
				contentImages: Array.isArray(pin.contentImages) ? pin.contentImages : [],
			}], { brandKit, exportProfileId: selectedExportProfileId });
			const imageSource = resolved.usedArticleFallback ? 'featured_fallback' : 'ai_generated';
			applyTemplateComposeResults(
				composed.map((item) => ({ ...item, imageSource })),
				{ imageSource },
			);
		} catch (error) {
			const fallback = String(pin.sourceImageUrl || pin.featuredImage || '').trim();
			if (fallback) {
				try {
					const brandKit = brandKits.find((item) => item.id === selectedBrandKitId) || null;
					const composed = await composeAndUploadFeaturedPins([{
						...pin,
						featuredImage: fallback,
						contentImages: Array.isArray(pin.contentImages) ? pin.contentImages : [],
					}], { brandKit, exportProfileId: selectedExportProfileId });
					applyTemplateComposeResults(composed, { imageSource: 'featured_fallback' });
					toast({
						title: 'Used article image',
						description: 'AI regenerate failed; composed the selected template on the article image instead.',
					});
					return;
				} catch {
					// fall through
				}
			}
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
		if (generatingImages) {
			toast({
				variant: 'destructive',
				title: 'Images still generating',
				description: 'Wait until Studio finishes rendering images, then Save Draft.',
			});
			return;
		}

		setSavingGenerated(true);
		try {
			const created = await createPinRecords({ previewPins: generatedPreviewPins });
			setSavedPins((prev) => [...created, ...prev]);
			setGeneratedPreviewPins([]);
			if (!pinterestConnected) {
				toast({
					title: 'Pins saved',
					description: L.savedConnectNext,
				});
			} else if (isGuidedSetup) {
				toast({
					title: 'Pins saved',
					description: `${created.length} ${L.savedPublishSetup}`,
				});
			} else {
				toast({
					title: 'Pins saved',
					description: `${created.length} ${L.savedPublishOperate}`,
				});
			}
			refreshPinterest();
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
		let pins = resolveActionPins(explicitPins);
		const { accountId, boardId } = resolvePublishTargets(pins);
		try {
			pins = await preparePinsForPublish(pins);
			assertPublishTargets(pins, accountId, boardId);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Cannot publish', description: error.message });
			return;
		}

		if (accountId && accountId !== selectedAccountId) setSelectedAccountId(accountId);
		if (boardId && boardId !== selectedBoardId) setSelectedBoardId(boardId);

		publishAbortRef.current?.abort?.();
		const controller = new AbortController();
		publishAbortRef.current = controller;

		setPublishing(true);
		setPublishResult(null);
		setPublishProgress({ phase: 'submitting', jobs: [], elapsedMs: 0, message: 'Submitting…' });
		setPublishProgressOpen(true);

		try {
			const result = await destination.runPublishNowFlow({
				pinIds: pins.map((pin) => pin.id),
				accountId,
				boardId,
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
			setActionPinIds([]);
			if (result.ok) {
				toast({
					title: '✓ First pin published',
					description: `${result.message || 'Published successfully.'} Next: open Analytics.`,
				});
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
		// Prefer explicit pins / selection / inspector; fall back to all drafts so the
		// Library "Schedule" control can open the modal without a prior checkbox selection.
		let pins = resolveActionPins(explicitPins);
		if (pins.length === 0 && explicitPins == null) {
			pins = draftPins;
		}
		if (pins.length === 0) {
			toast({
				variant: 'destructive',
				title: 'Cannot schedule',
				description: 'Save or select one or more draft pins first, then try Schedule again.',
			});
			return;
		}
		setActionPinIds(pins.map((pin) => pin.id));
		setScheduleModalOpen(true);
	};

	const handleScheduleSubmit = async (form) => {
		let pins = resolveActionPins();
		if (pins.length === 0) {
			throw new Error('Select draft pins first');
		}

		const accountId = form.accountId || resolvePublishTargets(pins).accountId;
		const boardId = form.boardId || resolvePublishTargets(pins).boardId;
		pins = await preparePinsForPublish(pins);
		assertPublishTargets(pins, accountId, boardId);

		setScheduling(true);
		try {
			const perPinTargets = buildPerPinTargets(pins);
			let scheduledLabel = '';

			if (form.useSmartSlot || !form.scheduledAt) {
				const result = await destination.addPinsToQueue({
					config,
					pinIds: pins.map((pin) => pin.id),
					accountId,
					boardId,
					perPinTargets,
				});
				scheduledLabel = result.slots?.[0]?.localLabel || 'next queue slot';
			} else {
				const occurrences = expandRecurrence({
					mode: form.mode,
					startAt: form.scheduledAt,
					endAt: form.endAt,
					customIntervalDays: form.customIntervalDays,
				});

				if (occurrences.length === 1) {
					await destination.schedulePins({
						pinIds: pins.map((pin) => pin.id),
						accountId,
						boardId,
						timezone: form.timezone || publishingConfig.timezone,
						scheduledAt: occurrences[0],
						perPinTargets,
					});
				} else {
					const pinIdsByOccurrence = [pins.map((pin) => pin.id)];
					for (let i = 1; i < occurrences.length; i += 1) {
						const copies = [];
						for (const pin of pins) {
							copies.push(await duplicatePin(pin, { titleSuffix: ` (${i + 1}/${occurrences.length})` }));
						}
						pinIdsByOccurrence.push(copies.map((pin) => pin.id));
					}
					await destination.scheduleRecurrenceSeries({
						occurrenceDates: occurrences,
						pinIdsByOccurrence,
						accountId,
						boardId,
						timezone: form.timezone || publishingConfig.timezone,
						perPinTargets,
					});
				}
				scheduledLabel = `${occurrences.length} occurrence(s)`;
			}

			setSelectedAccountId(accountId);
			setSelectedBoardId(boardId);
			if (form.timezone) setTimezone(form.timezone);
			setScheduleModalOpen(false);
			setActionPinIds([]);
			await loadPins();
			clearDraftPinSelection();
			setWorkspaceTab('queue');
			toast({
				title: 'Scheduled',
				description: `${pins.length} pin(s) queued · ${scheduledLabel}. Visible in Queue, Calendar, and History.`,
			});
		} finally {
			setScheduling(false);
		}
	};

	const handleAddToQueue = async (explicitPins) => {
		let pins = resolveActionPins(explicitPins);
		const { accountId, boardId } = resolvePublishTargets(pins);
		try {
			pins = await preparePinsForPublish(pins);
			assertPublishTargets(pins, accountId, boardId);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Cannot queue', description: error.message });
			return;
		}

		setQueueing(true);
		try {
			const result = await destination.addPinsToQueue({
				config,
				pinIds: pins.map((pin) => pin.id),
				accountId,
				boardId,
				perPinTargets: buildPerPinTargets(pins),
			});
			await loadPins();
			clearDraftPinSelection();
			setActionPinIds([]);
			setWorkspaceTab('queue');
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
		const preview = buildPinPreview({
			pin: {
				...pin,
				accountId: pin.accountId || selectedAccountId,
				boardId: pin.boardId || selectedBoardId,
				sourceUrl: pin.sourceUrl || pin.articleUrl || pin.destinationUrl || article?.url || '',
			},
			account,
			board,
			article,
			websiteUrl: pin.sourceUrl || pin.articleUrl || article?.url || '',
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
			const copyResult = await generatePinsForArticle(article, 1, {
				...panel,
				imageMode: panel.imageMode === 'use_featured' ? 'use_featured' : panel.imageMode,
			});
			const regenerated = Array.isArray(copyResult?.pins) ? copyResult.pins[0] : null;
			if (!regenerated) {
				throw new Error('Failed to regenerate pin copy');
			}
			const response = await apiServerClient.fetch(`/ai-pins/pins/${encodeURIComponent(pin.id)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
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
				}),
			});
			const updated = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(updated?.message || `Failed to regenerate pin (${response.status})`);
			}
			setSavedPins((prev) => prev.map((item) => (item.id === pin.id ? mapSavedPin(updated) : item)));
			const usedTextFallback = copyResult?.copySource === PIN_COPY_SOURCE.LOCAL_TEXT_FALLBACK;
			toast({
				title: usedTextFallback ? 'Regenerated with local copy' : 'Regenerated',
				description: usedTextFallback
					? `Text AI was temporarily unavailable (${copyResult.fallbackReason || 'temporary'}). Pin copy refreshed from the article.`
					: (panel.imageMode === 'use_featured'
						? 'Pin copy refreshed from article (no AI).'
						: 'Pin draft regenerated with AI.'),
			});
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
				const { items } = await destination.listDestinations(accountId);
				accountBoards = items;
				setBoardsByAccount((prev) => ({ ...prev, [accountId]: accountBoards }));
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
		}));
	};

	const loadReferenceImages = async () => {
		setLoadingReferenceImages(true);
		try {
			const items = await listReferenceImages();
			setReferenceImages(items.map((item) => ({
				id: item.id,
				name: item.name || item.originalName || 'reference',
				url: item.url,
			})));
		} catch (error) {
			toast({ variant: 'destructive', title: 'Reference images', description: error.message });
		} finally {
			setLoadingReferenceImages(false);
		}
	};

	const handleReferenceUpload = async (event) => {
		const picked = Array.from(event.target.files || []);
		event.target.value = '';
		if (picked.length === 0) return;

		const remaining = Math.max(0, 6 - referenceImages.length);
		if (remaining <= 0) {
			toast({
				variant: 'destructive',
				title: 'Limit reached',
				description: 'You can store up to 6 reference images.',
			});
			return;
		}

		const files = picked.slice(0, remaining);
		setUploadingReferenceImages(true);
		try {
			const uploaded = await uploadReferenceImages(files);
			if (uploaded.length === 0) {
				throw new Error('No images were saved');
			}
			setReferenceImages((prev) => [
				...uploaded.map((item) => ({
					id: item.id,
					name: item.name || item.originalName || 'reference',
					url: item.url,
				})),
				...prev,
			].slice(0, 6));
			toast({
				title: 'Reference images saved',
				description: `${uploaded.length} image(s) uploaded and stored.`,
			});
		} catch (error) {
			toast({ variant: 'destructive', title: 'Upload failed', description: error.message });
		} finally {
			setUploadingReferenceImages(false);
		}
	};

	const removeReferenceImage = async (id) => {
		const previous = referenceImages;
		setReferenceImages((prev) => prev.filter((item) => item.id !== id));
		try {
			await deleteReferenceImage(id);
		} catch (error) {
			setReferenceImages(previous);
			toast({ variant: 'destructive', title: 'Delete failed', description: error.message });
		}
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

	const hasPublishedForSite = useMemo(
		() => savedPins.some((pin) => String(pin.status || '').toLowerCase() === 'published'),
		[savedPins],
	);
	const isGuidedSetup = !hasPublishedForSite;
	const visibleCreateModes = useMemo(
		() => (isGuidedSetup ? CREATE_MODES.filter((mode) => mode.id !== 'bulk') : CREATE_MODES),
		[isGuidedSetup],
	);

	useEffect(() => {
		if (isGuidedSetup && createMode === 'bulk') {
			setCreateMode('single');
		}
	}, [isGuidedSetup, createMode]);

	const generateLabel = createMode === 'bulk'
		? L.generateMany(Math.max(1, selectedArticleIds.size) * panel.count)
		: panel.count > 1
			? L.generateMany(panel.count)
			: L.generateOne;

	const goConnectPinterest = () => {
		const returnTo = `${routes.studio}?websiteId=${encodeURIComponent(websiteId || '')}&setup=publish`;
		setSetupReturnPath(returnTo);
		navigate(`${routes.connect}?websiteId=${encodeURIComponent(websiteId || '')}&setup=1`);
	};

	return (
		<div className={`ai-pins-atelier${isFacebookStudio ? ' ai-facebook-atelier' : ''}`}>
			<div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{platformName} Studio</p>
					<h1 className="font-display text-3xl font-semibold tracking-tight">{L.atelierTitle}</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						{isGuidedSetup
							? L.guidedSetup(activeWebsite?.name || activeWebsite?.domain || 'this website')
							: L.operateSubtitle(activeWebsite ? (activeWebsite.name || activeWebsite.domain) : '')}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{/* Templates / Brand Kit managers: Admin Console only (routes kept). */}
					{false && showBrandKit ? <Link to={routes.brandKit}><Button variant="outline" size="sm"><Palette size={14} /> Brand Kit</Button></Link> : null}
					{false && showTemplates ? <Link to={routes.templates}><Button variant="outline" size="sm"><LayoutTemplate size={14} /> Templates</Button></Link> : null}
					{!isGuidedSetup && showHistory ? (
						<Link to={websiteId ? `${routes.history}?websiteId=${encodeURIComponent(websiteId)}` : routes.history}>
							<Button variant="outline" size="sm"><History size={14} /> {L.historyNav}</Button>
						</Link>
					) : null}
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

			{isGuidedSetup && savedPins.length > 0 && !pinterestConnected ? (
				<div className="mb-4 flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p className="text-sm font-medium">{L.connectBannerTitle}</p>
						<p className="text-xs text-muted-foreground">{L.connectBannerBody}</p>
					</div>
					<Button size="sm" onClick={goConnectPinterest}>{L.connectCta}</Button>
				</div>
			) : null}

			{isGuidedSetup && (pinterestConnected || setupPublish) && savedPins.some((pin) => pin.status === 'draft' || !pin.status || pin.status === 'ready') ? (
				<div className="mb-4 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-sm">{L.readyBanner}</p>
					<Button size="sm" onClick={() => runPublishNow()} disabled={publishing}>Publish first {L.itemLower}</Button>
				</div>
			) : null}

			{showPinterest && !pinterestConnected && !loadingAccounts ? (
				<div className="mb-4 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-sm text-foreground/90">{L.connectStudioHint}</p>
					<Button size="sm" onClick={goConnectPinterest}>{L.connectCta}</Button>
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
							<h2 className="font-display text-xl font-semibold">{L.composerSectionTitle}</h2>
							<p className="text-xs text-muted-foreground">
								{typeof L.workflowSubtitle === 'function' ? L.workflowSubtitle(platformName) : L.workflowSubtitle}
							</p>
						</div>
						<span className="rounded-full bg-accent/20 px-2.5 py-1 text-[11px] font-semibold text-accent-foreground">
							{(credits.ai?.remaining ?? 0)} credits
						</span>
					</div>

					<div className="ai-pins-mode-tabs mb-4">
						{visibleCreateModes.map(({ id, label, icon: Icon }) => (
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

					<div className="space-y-4" data-ai-pins-articles>
						<p className="ai-pins-step-label">Step 1 — Select Article</p>
						<Select label="Website" value={websiteId} onChange={(e) => setWebsiteId(e.target.value)} disabled={loadingWebsites}>
							<option value="">Select website</option>
							{websites.map((website) => (
								<option key={website.id} value={website.id}>{websiteOptionLabel(website)}</option>
							))}
						</Select>

						{createMode === 'prompt' ? (
							<>
								<Textarea
									label="Prompt"
									rows={5}
									value={promptOnlyText}
									onChange={(e) => setPromptOnlyText(e.target.value)}
									placeholder={L.promptPlaceholder}
								/>
								<Input
									label={L.textOverlay}
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
									label={L.textOverlay}
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

						<div className="ai-pins-template-step-wrap">
							<p className="ai-pins-step-label">Step 2 — Choose Template</p>
							<button
								type="button"
								className={`ai-pins-template-step ${(selectedTemplate || (gallerySelectionActive && selectedTemplateId)) ? 'has-selection' : 'is-empty'} ${templateHydrating ? 'is-loading' : ''}`}
								onClick={handleChooseDesignLibraryTemplate}
								disabled={templateHydrating}
								aria-label={selectedTemplate
									? `Change template: ${selectedTemplate.name || 'Selected template'}`
									: 'Choose a Template'}
							>
								{(selectedTemplate || (gallerySelectionActive && selectedTemplateId)) ? (
									<>
										<div className="ai-pins-template-step__media" aria-hidden="true">
											{templateStepPreview.url ? (
												<img src={templateStepPreview.url} alt="" />
											) : (
												<div className="ai-pins-template-step__placeholder">
													<LayoutTemplate size={28} />
												</div>
											)}
											{templateStepPremium ? (
												<span className="ai-pins-template-step__badge">Premium</span>
											) : null}
										</div>
										<div className="ai-pins-template-step__body">
											<p className="ai-pins-template-step__name">
												{selectedTemplate?.name || (templateHydrating ? 'Loading template…' : 'Selected template')}
											</p>
											<p className="ai-pins-template-step__meta">
												{selectedTemplate?.category || 'general'}
												{templateHydrating ? ' · Loading…' : ''}
											</p>
											{originalTemplateUnavailable ? (
												<p className="ai-pins-template-step__unavailable" role="status">
													{ORIGINAL_TEMPLATE_UNAVAILABLE}
												</p>
											) : null}
											<span className="ai-pins-template-step__cta">Change Template</span>
										</div>
									</>
								) : (
									<div className="ai-pins-template-step__empty">
										<span className="ai-pins-template-step__empty-icon" aria-hidden="true">
											<Library size={22} />
										</span>
										<p className="ai-pins-template-step__empty-title">Choose a Template</p>
										<p className="ai-pins-template-step__empty-copy">
											Browse the {platformName} library and pick a ready-made pin design.
										</p>
									</div>
								)}
							</button>
							{templateHydrationError ? (
								<p className="ai-pins-template-step__error" role="alert">{templateHydrationError}</p>
							) : null}
							{originalTemplateUnavailable && !templateHydrationError ? (
								<p className="ai-pins-template-step__error" role="status">
									{ORIGINAL_TEMPLATE_UNAVAILABLE}. The draft still uses its stored template snapshot.
								</p>
							) : null}
						</div>

						<label className="flex items-center gap-2 text-sm">
							<input type="checkbox" checked={includeWebsiteUrl} onChange={(e) => setIncludeWebsiteUrl(e.target.checked)} />
							{isFacebookStudio ? 'Include website URL on post' : 'Include website URL on pin'}
						</label>

						<div className="grid grid-cols-2 gap-3">
							<Select label="Image type" value={imageType} onChange={(e) => setImageType(e.target.value)}>
								<option value="pin">{isFacebookStudio ? 'Post' : 'Pin'}</option>
								<option value="story">Story</option>
								<option value="carousel">Carousel frame</option>
							</Select>
							<Select label={L.numberOfItems} value={String(panel.count)} onChange={(e) => setPanel((prev) => ({ ...prev, count: Number(e.target.value) }))}>
								{pinCounts.map((count) => <option key={count} value={count}>{count}</option>)}
							</Select>
						</div>

						{false ? (
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
						) : null}

						<div>
							<p className="mb-1.5 text-sm font-medium">{L.sizeSection}</p>
							<div className="grid grid-cols-4 gap-2">
								{studioAssets.aspectRatios.map((item) => (
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
								<button
									type="button"
									className="text-xs text-primary disabled:opacity-50"
									onClick={() => referenceInputRef.current?.click()}
									disabled={uploadingReferenceImages || loadingReferenceImages || referenceImages.length >= 6}
								>
									{uploadingReferenceImages ? 'Uploading…' : 'Upload'}
								</button>
							</div>
							<input ref={referenceInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleReferenceUpload} />
							<div className="flex flex-wrap gap-2">
								{loadingReferenceImages && referenceImages.length === 0 ? (
									<div className="flex h-16 w-16 items-center justify-center rounded-xl border border-border">
										<Spinner className="h-4 w-4" />
									</div>
								) : referenceImages.length === 0 ? (
									<button type="button" onClick={() => referenceInputRef.current?.click()} className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground hover:bg-secondary" disabled={uploadingReferenceImages}>
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

						{!isGuidedSetup ? (
							<>
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
								<Select label="Studio template override" value={gallerySelectionActive ? '' : selectedTemplateId} onChange={(e) => handleStudioTemplateChange(e.target.value)} disabled={!showTemplates || templateHydrating}>
									<option value="">{gallerySelectionActive ? 'Clear gallery (system default)' : 'System default'}</option>
									{templates.map((template) => (
										<option key={template.id} value={template.id}>{template.name}{template.isDefault ? ' (Default)' : ''}</option>
									))}
								</Select>
								<Select label="Brand Kit" value={selectedBrandKitId} onChange={(e) => setSelectedBrandKitId(e.target.value)} disabled={!showBrandKit}>
									<option value="">No brand kit</option>
									{brandKits.map((kit) => (
										<option key={kit.id} value={kit.id}>{kit.name}{kit.isDefault ? ' (Default)' : ''}</option>
									))}
								</Select>
								<Select label={L.itemStyle} value={panel.style} onChange={(e) => setPanel((prev) => ({ ...prev, style: e.target.value }))}>
									{pinStyles.length === 0 ? <option value="">No styles configured</option> : null}
									{pinStyles.map((style) => <option key={style} value={style}>{style}</option>)}
								</Select>
								<Input label={L.itemTitleSeed} value={panel.pinTitle} onChange={(e) => setPanel((prev) => ({ ...prev, pinTitle: e.target.value }))} />
								<Textarea label="Description seed" rows={3} value={panel.pinDescription} onChange={(e) => setPanel((prev) => ({ ...prev, pinDescription: e.target.value }))} />
								<Input label="Target audience" value={panel.targetAudience} onChange={(e) => setPanel((prev) => ({ ...prev, targetAudience: e.target.value }))} />
								<Input label="Tone of voice" value={panel.toneOfVoice} onChange={(e) => setPanel((prev) => ({ ...prev, toneOfVoice: e.target.value }))} />
								<Input label="Language" value={panel.language} onChange={(e) => setPanel((prev) => ({ ...prev, language: e.target.value }))} />
								{analysis ? (
									<div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground space-y-1">
										<p><span className="font-medium text-foreground">CTA:</span> {analysis.cta || '—'}</p>
										<p><span className="font-medium text-foreground">Category:</span> {analysis.pinterestCategory || '—'}</p>
										<p><span className="font-medium text-foreground">Keywords:</span> {(analysis.keywords || []).join(', ') || '—'}</p>
									</div>
								) : null}
							</div>
						) : null}
							</>
						) : null}
					</div>

					<div className="sticky bottom-0 mt-5 space-y-2 border-t border-border/80 bg-gradient-to-t from-card via-card to-transparent pt-4">
						<p className="ai-pins-step-label">{L.generateStep}</p>
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
							{generating ? <Spinner className="h-4 w-4" /> : (isFacebookStudio ? <Share2 size={16} /> : <Wand2 size={16} />)}
							{generating ? 'Generating…' : generateLabel}
						</Button>
					</div>
				</aside>

				<section className="ai-pins-atelier__canvas p-4 sm:p-5">
					<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex flex-wrap gap-1 rounded-xl border border-border bg-background/70 p-1">
							{[
								{ id: 'studio', label: 'Studio', icon: isFacebookStudio ? Share2 : Sparkles },
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
									<Button size="sm" onClick={saveGeneratedPreviewPins} disabled={savingGenerated || generatingImages}>
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
												{pin.imageGenerationStatus === 'failed' ? (
													<div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
														<ImageIcon size={22} />
														<p className="text-xs font-medium text-destructive">Image failed</p>
														<p className="text-[11px]">{pin.imageGenerationError || 'Retry generation'}</p>
													</div>
												) : isFacebookStudio ? (
													<StudioPreviewCard
														variant={previewVariant}
														compact
														mediaAspectClass={inspectorPreviewAspectClass}
														imageUrl={pin.imageUrl || ''}
														featuredImageUrl={pin.featuredImage || ''}
														logoUrl={selectedBrandKit?.logoUrl || ''}
														pageName={pin.boardName || facebookPageName}
														linkUrl={pin.sourceUrl || pin.articleUrl || pin.website || pin.destinationUrl || ''}
														context={{
															title: pin.title,
															subtitle: pin.subtitle,
															description: pin.description,
															category: pin.category,
															website: pin.website,
															author: pin.author,
															overlayText: pin.overlayText,
														}}
													/>
												) : pin.imageUrl ? (
													<img src={pin.imageUrl} alt={pin.title} loading="lazy" decoding="async" />
												) : pin.templateConfig ? (
													<div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
														<StudioPreviewCard
															variant={previewVariant}
															config={pin.templateConfig}
															featuredImageUrl={pin.featuredImage || ''}
															logoUrl={selectedBrandKit?.logoUrl || ''}
															context={{
																title: pin.title,
																subtitle: pin.subtitle,
																description: pin.description,
																category: pin.category,
																website: pin.website,
																author: pin.author,
																overlayText: pin.overlayText,
															}}
														/>
													</div>
												) : (
													<div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
														<Spinner className="h-5 w-5" />
														<p className="text-xs">Waiting for image…</p>
													</div>
												)}
											</div>
											<div className="space-y-2 p-3">
												<div className="flex items-center justify-between gap-2">
													<Badge tone={pin.imageGenerationStatus === 'failed' ? 'red' : pin.imageGenerationStatus === 'completed' ? 'green' : 'amber'}>
														{pin.imageGenerationStatus || 'draft'}
													</Badge>
													<span className="truncate text-[10px] text-muted-foreground">
														{[pin.recipeFamilyLabel, pin.layoutLabel || pin.templateName].filter(Boolean).join(' · ')}
													</span>
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
										{isFacebookStudio ? <Share2 size={28} /> : <Wand2 size={28} />}
									</div>
									<h3 className="font-display text-2xl font-semibold">{L.canvasReadyTitle}</h3>
									<p className="mt-2 max-w-md text-sm text-muted-foreground">
										{L.emptyCanvas}
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
									<Select label={L.account} value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)} disabled={loadingAccounts || accounts.length === 0}>
										<option value="">Select account</option>
										{accounts.map((account) => (
											<option key={account.id} value={account.id}>
												{account.label || account.accountName || account.username}
												{account.isDefault ? ' (Default)' : ''}
											</option>
										))}
									</Select>
									<Select label={L.destination} value={selectedBoardId} onChange={(e) => setSelectedBoardId(e.target.value)} disabled={loadingBoards || boards.length === 0}>
										<option value="">{L.selectDestination}</option>
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
									<Button
										size="sm"
										type="button"
										onClick={() => runPublishNow()}
										disabled={publishing || draftPins.length === 0 || accounts.length === 0 || !destinationCaps.publishNow}
									>
										<Send size={13} /> Publish Now
									</Button>
									<Button
										size="sm"
										type="button"
										variant="outline"
										onClick={() => openScheduleModal()}
										disabled={scheduling || !destinationCaps.schedule}
									>
										<CalendarClock size={13} /> Schedule
									</Button>
									<Button
										size="sm"
										type="button"
										variant="outline"
										onClick={() => handleAddToQueue()}
										disabled={queueing || publishing || draftPins.length === 0 || accounts.length === 0 || !destinationCaps.queueImplemented}
									>
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
										toast({ title: 'Drafts', description: L.saveDraftHint });
									}} disabled={savingGenerated}>
										{savingGenerated ? <Spinner className="h-3.5 w-3.5" /> : null} Save Draft
									</Button>
									{showPublishingHistory ? (
										<Link to={routes.publishingHistory}><Button size="sm" variant="ghost"><History size={13} /> History</Button></Link>
									) : null}
								</div>
							</div>

							<div className="mb-3 flex flex-wrap items-center gap-2">
								<select className="rounded-xl border border-input bg-background px-3 py-2 text-xs" value={pinFilter} onChange={(e) => setPinFilter(e.target.value)}>
									<option value="all">{L.filterAllItems}</option>
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
								{loadingPins ? <Spinner className="h-4 w-4" /> : <span className="text-xs text-muted-foreground">{L.itemCountLabel(filteredSavedPins.length)}</span>}
							</div>

							{filteredSavedPins.length === 0 ? (
								<Empty
									icon={isFacebookStudio ? Share2 : Sparkles}
									title={L.libraryEmptyTitle}
									subtitle={L.libraryEmpty}
									action={(
										<Button
											size="sm"
											onClick={() => {
												const el = document.querySelector('[data-ai-pins-articles]');
												if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
											}}
										>
											Select articles to start
										</Button>
									)}
								/>
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
													{isFacebookStudio ? (
														<StudioPreviewCard
															variant={previewVariant}
															compact
															mediaAspectClass={inspectorPreviewAspectClass}
															imageUrl={pin.imageUrl || ''}
															featuredImageUrl={pin.featuredImage || ''}
															logoUrl={selectedBrandKit?.logoUrl || ''}
															pageName={pin.boardName || facebookPageName}
															linkUrl={pin.sourceUrl || pin.articleUrl || pin.website || pin.destinationUrl || ''}
															context={{
																title: pin.title,
																description: pin.description,
																website: pin.website,
															}}
														/>
													) : pin.imageUrl ? (
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
														<span className="text-[10px] text-muted-foreground">{pin.boardName || L.noDestination}</span>
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
									{' '}retry {publishingConfig.retryPolicy.raw}. Scheduled {L.itemLowerPlural} appear on Calendar automatically.
								</p>
								<div className="mt-3 flex flex-wrap gap-2">
									<Button size="sm" type="button" onClick={() => handleAddToQueue()} disabled={queueing || draftPins.length === 0 || accounts.length === 0}>
										<ListPlus size={13} /> Add selected to queue
									</Button>
									{showPublishingHistory ? (
										<Link to={routes.publishingHistory}><Button size="sm" variant="outline"><History size={13} /> {L.publishingHistoryNav}</Button></Link>
									) : null}
								</div>
							</div>
							{failedPins.length === 0 && savedPins.filter((pin) => pin.status === 'scheduled' || pin.status === 'publishing').length === 0 ? (
								<Empty icon={ListChecks} title="Queue is clear" subtitle={L.queueEmptySubtitle} />
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
												{pin.publishError ? (
													<pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-destructive">
														{pin.publishError}
													</pre>
												) : null}
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
								<h3 className="font-display text-lg font-semibold">{L.detailsTitle}</h3>
							</div>
							<button type="button" className="rounded-lg border border-border p-1.5 hover:bg-secondary" onClick={closeInspector}>
								<X size={14} />
							</button>
						</div>

						<div className="mb-4 overflow-hidden rounded-2xl border border-border">
							<div className={`${isFacebookStudio ? '' : inspectorPreviewAspectClass} bg-secondary`}>
								{isFacebookStudio ? (
									<StudioPreviewCard
										variant={previewVariant}
										mediaAspectClass={inspectorPreviewAspectClass}
										imageUrl={inspectorPin.imageUrl || ''}
										featuredImageUrl={inspectorPin.featuredImage || ''}
										logoUrl={selectedBrandKit?.logoUrl || ''}
										pageName={inspectorPin.boardName || facebookPageName}
										linkUrl={inspectorPin.sourceUrl || inspectorPin.articleUrl || inspectorPin.website || inspectorPin.destinationUrl || ''}
										context={{
											title: inspectorPin.title,
											subtitle: inspectorPin.subtitle,
											description: inspectorPin.description,
											category: inspectorPin.category,
											website: inspectorPin.website,
											author: inspectorPin.author,
											overlayText: inspectorPin.overlayText,
										}}
									/>
								) : inspectorPin.imageUrl ? (
									<img src={inspectorPin.imageUrl} alt={inspectorPin.title} className="h-full w-full object-cover" />
								) : inspectorPin.templateConfig ? (
									<div className="p-2">
										<StudioPreviewCard
											variant={previewVariant}
											config={inspectorPin.templateConfig}
											featuredImageUrl={inspectorPin.featuredImage || ''}
											logoUrl={selectedBrandKit?.logoUrl || ''}
											context={{
												title: inspectorPin.title,
												subtitle: inspectorPin.subtitle,
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
							<Input label="Subtitle" value={inspectorPin.subtitle || ''} onChange={(e) => updateInspectorField('subtitle', e.target.value)} />
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
							<div className="grid grid-cols-1 gap-2 rounded-xl border border-border/70 bg-secondary/30 p-3 text-xs">
								<div>
									<p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Image Source</p>
									<p>{formatImageSourceLabel(inspectorPin)}</p>
								</div>
								<div>
									<p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Template Name</p>
									<p className="truncate" title={inspectorPin.templateName || ''}>{inspectorPin.templateName || '—'}</p>
								</div>
								<div>
									<p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Destination URL</p>
									{inspectorPin.sourceUrl || inspectorPin.articleUrl || inspectorPin.destinationUrl ? (
										<a
											href={inspectorPin.sourceUrl || inspectorPin.articleUrl || inspectorPin.destinationUrl}
											target="_blank"
											rel="noreferrer"
											className="break-all text-primary hover:underline"
										>
											{inspectorPin.sourceUrl || inspectorPin.articleUrl || inspectorPin.destinationUrl}
										</a>
									) : (
										<p className="text-destructive">Missing article URL</p>
									)}
								</div>
							</div>

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
									<Select label="Studio template override" value={gallerySelectionActive ? '' : selectedTemplateId} onChange={(e) => handleStudioTemplateChange(e.target.value)}>
										<option value="">{gallerySelectionActive ? 'Clear gallery (system default)' : 'System default'}</option>
										{templates.map((template) => (
											<option key={template.id} value={template.id}>{template.name}</option>
										))}
									</Select>
									{templateHydrationError ? (
										<p className="text-[10px] text-destructive" role="alert">{templateHydrationError}</p>
									) : null}
									<Select label={L.targetAccount} value={inspectorPin.accountId || ''} onChange={(e) => setPinTargetAccount(inspectorPin.id, e.target.value)}>
										<option value="">Use global account</option>
										{accounts.map((account) => (
											<option key={account.id} value={account.id}>{account.label || account.accountName || account.username}</option>
										))}
									</Select>
									<Select label={L.targetDestination} value={inspectorPin.boardId || ''} onChange={(e) => updatePinField(inspectorPin.id, 'boardId', e.target.value)}>
										<option value="">{L.useGlobalDestination}</option>
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
										<Button className="flex-1" type="button" onClick={() => handleSaveEdit(inspectorPin)}>Save Draft</Button>
										<Button type="button" variant="outline" onClick={() => handlePreviewPin(inspectorPin)}><Eye size={14} /> Preview</Button>
										<Button type="button" variant="outline" onClick={() => runPublishNow([inspectorPin])} disabled={publishing || !showPinterest}><Send size={14} /></Button>
										<Button type="button" variant="outline" onClick={() => openScheduleModal([inspectorPin])} disabled={scheduling}><CalendarClock size={14} /></Button>
										<Button type="button" variant="outline" onClick={() => handleAddToQueue([inspectorPin])} disabled={queueing}><ListPlus size={14} /></Button>
										<Button type="button" variant="outline" onClick={() => handleDuplicatePin(inspectorPin)}><Copy size={14} /></Button>
										<Button type="button" variant="outline" onClick={() => handleRegeneratePin(inspectorPin)} disabled={generating}><RefreshCw size={14} /></Button>
										<Button type="button" variant="ghost" onClick={() => handleDeletePin(inspectorPin.id)}><Trash2 size={14} /></Button>
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
				onClose={() => { setScheduleModalOpen(false); setActionPinIds([]); }}
				onSubmit={handleScheduleSubmit}
				submitting={scheduling}
				accounts={accounts}
				boards={boards}
				defaultAccountId={selectedAccountId || resolvePublishTargets(resolveActionPins()).accountId}
				defaultBoardId={selectedBoardId || resolvePublishTargets(resolveActionPins()).boardId}
				defaultTimezone={publishingConfig.timezone || timezone}
				pinCount={actionPinIds.length || selectedDraftPins.length || (editingPinId ? 1 : 0)}
				queueHint={`Leave empty to use next Workspace Queue slot (${publishingConfig.timezone}, every ${publishingConfig.intervalMinutes}m, ${publishingConfig.dailyLimit}/day).`}
				labels={L}
			/>
			<PreviewPinModal
				open={Boolean(previewModal)}
				preview={previewModal}
				onClose={() => setPreviewModal(null)}
				publishing={publishing}
				labels={L}
				previewVariant={previewVariant}
				mediaAspectClass={inspectorPreviewAspectClass}
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
				onOpenHistory={showPublishingHistory ? () => navigate(routes.publishingHistory) : undefined}
				labels={L}
				normalizeResponses={destination.normalizeProgressResult}
			/>
			<PinTemplateChooser
				open={templateChooserOpen}
				onClose={() => setTemplateChooserOpen(false)}
				selectedId={selectedTemplateId}
				selecting={templateHydrating}
				selectingId={selectedTemplateId}
				previewArticle={activeArticle || selectedArticles[0] || null}
				templatePack={studioAssets.templatePack}
				onSelect={(template) => {
					void selectGalleryTemplate(template);
				}}
			/>
			<UpgradeModal
				open={Boolean(upgradeModal)}
				onClose={() => setUpgradeModal(null)}
				templateId={upgradeModal?.templateId || ''}
				templateName={upgradeModal?.templateName || ''}
				access={upgradeModal?.access || null}
				sourcePage={upgradeModal?.sourcePage || 'ai_pins_chooser'}
				requiredFeatureKeys={upgradeModal?.requiredFeatureKeys}
			/>
		</div>
	);
}
