import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Image as ImageIcon, Wand2, Loader2, Download, Save, ChevronDown,
	Sparkles, Settings2, Layers, Copy, RefreshCw, Trash2, Search,
	Star, Pin, LayoutTemplate, Palette, Upload, Coins, Heart,
} from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import apiServerClient from '@/lib/apiServerClient';
import { generateText } from '@/lib/aiGenerate';
import { Badge, Button, Input, Select, Spinner, Textarea } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import './ImagesPage.css';

const FORMATS = [
	{ id: 'square', label: 'Square', ratio: '1:1', box: 'aspect-square' },
	{ id: 'portrait', label: 'Portrait (Pin)', ratio: '2:3', box: 'aspect-[2/3]' },
	{ id: 'landscape', label: 'Landscape', ratio: '16:9', box: 'aspect-video' },
];

const QUICK_STYLES = [
	'Food Photography',
	'Healthy',
	'Dessert',
	'Coffee',
	'Rustic Kitchen',
	'Minimal',
	'Luxury',
	'Pinterest Viral',
	'Seasonal',
];

const SECTIONS = [
	{ id: 'prompt', label: 'Prompt', icon: Sparkles },
	{ id: 'styles', label: 'Quick Styles', icon: Wand2 },
	{ id: 'settings', label: 'Image Settings', icon: Settings2 },
	{ id: 'assets', label: 'Assets', icon: Layers },
];

const GEN_STEPS = [
	{ id: 'prepare', label: 'Preparing Prompt' },
	{ id: 'analyze', label: 'Analyzing Style' },
	{ id: 'generate', label: 'Generating Image' },
	{ id: 'enhance', label: 'Enhancing' },
	{ id: 'finalize', label: 'Finalizing' },
];

const RECENT_FILTERS = [
	{ id: 'newest', label: 'Newest' },
	{ id: 'favorites', label: 'Favorites' },
	{ id: 'today', label: 'Today' },
	{ id: 'week', label: 'This Week' },
];

const FAVORITES_KEY = 'chefia-image-favorites';

function Section({ id, open, onToggle, children }) {
	const meta = SECTIONS.find((item) => item.id === id);
	const Icon = meta?.icon || Settings2;
	return (
		<div className="img-section">
			<button type="button" className="img-section__head" onClick={() => onToggle(id)} aria-expanded={open}>
				<span className="inline-flex items-center gap-2">
					<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Icon size={14} />
					</span>
					{meta?.label || id}
				</span>
				<ChevronDown size={16} className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
			</button>
			{open ? <div className="img-section__body">{children}</div> : null}
		</div>
	);
}

function loadFavorites() {
	try {
		const raw = localStorage.getItem(FAVORITES_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function estimateCredits({ quality, count }) {
	const qualityFactor = quality === 'high' ? 1.6 : quality === 'standard' ? 1.1 : 0.85;
	return Number((qualityFactor * Math.max(1, count)).toFixed(1));
}

function startOfDay(date = new Date()) {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

export default function ImagesPage() {
	const { toast } = useToast();
	const [prompt, setPrompt] = useState('');
	const [baselinePrompt, setBaselinePrompt] = useState('');
	const [format, setFormat] = useState('portrait');
	const [loading, setLoading] = useState(false);
	const [genStep, setGenStep] = useState(0);
	const [gallery, setGallery] = useState([]);
	const [selectedId, setSelectedId] = useState('');
	const [pins, setPins] = useState([]);
	const [saving, setSaving] = useState(false);
	const [activeStyles, setActiveStyles] = useState([]);
	const [quality, setQuality] = useState('standard');
	const [imageCount, setImageCount] = useState(1);
	const [imageStyle, setImageStyle] = useState('Photographic');
	const [creativity, setCreativity] = useState(55);
	const [refStrength, setRefStrength] = useState(40);
	const [brandKits, setBrandKits] = useState([]);
	const [templates, setTemplates] = useState([]);
	const [brandKitId, setBrandKitId] = useState('');
	const [templateId, setTemplateId] = useState('');
	const [referenceUrl, setReferenceUrl] = useState('');
	const [dropActive, setDropActive] = useState(false);
	const [recentSearch, setRecentSearch] = useState('');
	const [recentFilter, setRecentFilter] = useState('newest');
	const [favorites, setFavorites] = useState(() => loadFavorites());
	const [openSections, setOpenSections] = useState({
		prompt: true,
		styles: true,
		settings: true,
		assets: true,
	});

	const fmt = FORMATS.find((f) => f.id === format) || FORMATS[1];
	const selected = gallery.find((item) => item.id === selectedId) || null;
	const selectedBrand = brandKits.find((item) => item.id === brandKitId) || null;
	const selectedTemplate = templates.find((item) => item.id === templateId) || null;
	const isDirty = prompt !== baselinePrompt;
	const creditEstimate = useMemo(
		() => estimateCredits({ quality, count: Number(imageCount) || 1 }),
		[quality, imageCount],
	);

	const load = async () => {
		try {
			setPins(await pb.collection('pins').getFullList({ sort: '-created', requestKey: 'pins' }));
		} catch (_) {
			/* */
		}
	};

	const loadAssets = async () => {
		try {
			const [kitsRes, templateRows] = await Promise.all([
				apiServerClient.fetch('/ai-pins/brand-kits', { method: 'GET' }).then(async (response) => {
					const payload = await response.json().catch(() => []);
					return response.ok && Array.isArray(payload) ? payload : [];
				}).catch(() => []),
				apiServerClient.fetch('/workspace/v1/templates?category=pin', { method: 'GET' }).then(async (response) => {
					const payload = await response.json().catch(() => ({}));
					return response.ok && Array.isArray(payload.items) ? payload.items : [];
				}).catch(() => []),
			]);
			setBrandKits(kitsRes);
			setTemplates(templateRows);
			if (!brandKitId && kitsRes[0]?.id) setBrandKitId(kitsRes.find((k) => k.isDefault)?.id || kitsRes[0].id);
			if (!templateId && templateRows[0]?.id) {
				const preferred = templateRows.find((t) => t.isDefault || t.is_default) || templateRows[0];
				setTemplateId(preferred.id);
			}
		} catch {
			/* UI-only asset lists */
		}
	};

	useEffect(() => {
		load();
		loadAssets();
	}, []);

	useEffect(() => {
		localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
	}, [favorites]);

	useEffect(() => {
		if (!loading) return undefined;
		setGenStep(0);
		const timers = [
			window.setTimeout(() => setGenStep(1), 700),
			window.setTimeout(() => setGenStep(2), 1800),
			window.setTimeout(() => setGenStep(3), 3600),
			window.setTimeout(() => setGenStep(4), 5200),
		];
		return () => timers.forEach((id) => window.clearTimeout(id));
	}, [loading]);

	const toggleSection = (id) => setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

	const toggleStyle = (style) => {
		const phrase = style.toLowerCase();
		setActiveStyles((prev) => {
			const enabled = !prev.includes(style);
			const next = enabled ? [...prev, style] : prev.filter((s) => s !== style);
			setPrompt((current) => {
				const trimmed = current.trim();
				if (enabled) {
					if (trimmed.toLowerCase().includes(phrase)) return current;
					return trimmed ? `${trimmed}, ${phrase}` : phrase;
				}
				const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				return current
					.replace(new RegExp(`(,\\s*)?${escaped}`, 'ig'), '')
					.replace(/^,\s*|,\s*$/g, '')
					.replace(/\s{2,}/g, ' ')
					.trim();
			});
			return next;
		});
	};

	const generate = async (event) => {
		event?.preventDefault?.();
		if (!prompt.trim()) {
			toast({ variant: 'destructive', title: 'Prompt required', description: 'Describe the image you want to create.' });
			return;
		}
		setLoading(true);
		setGallery([]);
		setSelectedId('');
		try {
			// Keep the existing generation workflow / prompt shape unchanged.
			const p = `Generate a vibrant, appetizing Pinterest food image. Aspect ratio ${fmt.ratio}. Subject: ${prompt}. Bright, high-quality food photography, styled for Pinterest.`;
			const { images } = await generateText(p);
			if (!images.length) throw new Error('No image was generated. Try again.');
			const now = Date.now();
			const mapped = images.map((url, index) => ({
				id: `gen-${now}-${index}`,
				url,
				prompt,
				format,
				ratio: fmt.ratio,
				createdAt: new Date(now).toISOString(),
				brandKitId: brandKitId || '',
				brandKitName: selectedBrand?.name || '',
				templateId: templateId || '',
				templateName: selectedTemplate?.name || '',
				source: 'session',
			}));
			setGallery(mapped);
			setSelectedId(mapped[0].id);
			setBaselinePrompt(prompt);
		} catch (err) {
			toast({ variant: 'destructive', title: 'Generation failed', description: err?.message });
		} finally {
			setLoading(false);
			setGenStep(GEN_STEPS.length - 1);
		}
	};

	const savePin = async (image = selected) => {
		if (!image?.url) return;
		setSaving(true);
		try {
			await pb.collection('pins').create({
				owner: pb.authStore.record.id,
				title: (image.prompt || prompt).slice(0, 120),
				image_url: image.url,
				format: image.format || format,
				status: 'draft',
			});
			toast({ title: 'Saved to pins' });
			setBaselinePrompt(image.prompt || prompt);
			await load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	const copyPrompt = async (value = selected?.prompt || prompt) => {
		if (!value?.trim()) return;
		try {
			await navigator.clipboard.writeText(value);
			toast({ title: 'Prompt copied' });
		} catch {
			toast({ variant: 'destructive', title: 'Copy failed', description: 'Clipboard access was blocked.' });
		}
	};

	const downloadImage = (url = selected?.url) => {
		if (!url) return;
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'chef-ia-image';
		anchor.target = '_blank';
		anchor.rel = 'noreferrer';
		anchor.click();
	};

	const deleteSelected = async () => {
		if (!selected) return;
		if (selected.source === 'library' && selected.pinId) {
			if (!confirm('Delete this saved pin?')) return;
			try {
				await pb.collection('pins').delete(selected.pinId);
				toast({ title: 'Deleted' });
				setGallery((prev) => prev.filter((item) => item.id !== selected.id));
				setSelectedId('');
				await load();
			} catch (err) {
				toast({ variant: 'destructive', title: 'Error', description: err?.message });
			}
			return;
		}
		setGallery((prev) => prev.filter((item) => item.id !== selected.id));
		setSelectedId('');
		toast({ title: 'Removed from gallery' });
	};

	const openPinInStudio = (pin) => {
		const item = {
			id: `pin-${pin.id}`,
			pinId: pin.id,
			url: pin.image_url,
			prompt: pin.title || '',
			format: pin.format || 'portrait',
			ratio: FORMATS.find((f) => f.id === pin.format)?.ratio || '2:3',
			createdAt: pin.created || new Date().toISOString(),
			brandKitName: '',
			templateName: '',
			source: 'library',
		};
		setGallery((prev) => {
			const exists = prev.find((g) => g.id === item.id);
			return exists ? prev : [item, ...prev];
		});
		setSelectedId(item.id);
		setPrompt(pin.title || '');
		setBaselinePrompt(pin.title || '');
		if (pin.format) setFormat(pin.format);
	};

	const toggleFavorite = (pinId) => {
		setFavorites((prev) => (prev.includes(pinId) ? prev.filter((id) => id !== pinId) : [...prev, pinId]));
	};

	const onDropReference = (event) => {
		event.preventDefault();
		setDropActive(false);
		const file = event.dataTransfer?.files?.[0];
		const uri = event.dataTransfer?.getData?.('text/uri-list') || event.dataTransfer?.getData?.('text/plain');
		if (uri && /^https?:\/\//i.test(uri.trim())) {
			setReferenceUrl(uri.trim());
			toast({ title: 'Reference URL applied' });
			return;
		}
		if (file) {
			toast({
				title: 'URL required',
				description: 'File hosting is not available here. Paste a hosted image URL instead.',
			});
		}
	};

	const filteredPins = useMemo(() => {
		const query = recentSearch.trim().toLowerCase();
		const now = new Date();
		const todayStart = startOfDay(now).getTime();
		const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

		let rows = [...pins];
		if (query) {
			rows = rows.filter((pin) => String(pin.title || '').toLowerCase().includes(query));
		}
		if (recentFilter === 'favorites') {
			rows = rows.filter((pin) => favorites.includes(pin.id));
		} else if (recentFilter === 'today') {
			rows = rows.filter((pin) => new Date(pin.created).getTime() >= todayStart);
		} else if (recentFilter === 'week') {
			rows = rows.filter((pin) => new Date(pin.created).getTime() >= weekStart);
		}
		return rows;
	}, [pins, recentSearch, recentFilter, favorites]);

	useEffect(() => {
		const onKeyDown = (event) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				if (selected && !saving) savePin(selected);
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [selected, saving, prompt, format]);

	return (
		<div className="img-atelier">
			<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Chef IA Studio</p>
					<h1 className="font-display text-3xl font-semibold tracking-tight">AI Image Generator</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Compose prompts, generate scroll-stopping food imagery, and save favorites into your pin library.
					</p>
				</div>
				<Link to="/app/ai-pins"><Button variant="outline" size="sm"><Pin size={14} /> Open AI Pins</Button></Link>
			</div>

			<div className="img-atelier__actions">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm font-medium">{prompt.trim() ? 'Prompt studio' : 'New image'}</span>
					{isDirty ? (
						<span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
							Unsaved changes
						</span>
					) : (
						<span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground">Ready</span>
					)}
					<span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
						<Coins size={12} /> ~{creditEstimate} credits
					</span>
					<span className="hidden text-[11px] text-muted-foreground sm:inline">Ctrl+S</span>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button size="sm" onClick={generate} disabled={loading}>
						{loading ? <Spinner className="h-4 w-4" /> : <Wand2 size={14} />}
						Generate
					</Button>
					<Button size="sm" variant="outline" onClick={generate} disabled={loading || !prompt.trim()}>
						<RefreshCw size={14} /> Regenerate
					</Button>
					<Button size="sm" variant="outline" onClick={() => downloadImage()} disabled={!selected}>
						<Download size={14} /> Download
					</Button>
					<Button size="sm" onClick={() => savePin()} disabled={!selected || saving}>
						{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save size={14} />}
						Save
					</Button>
					<Button size="sm" variant="ghost" onClick={() => copyPrompt()} disabled={!(selected?.prompt || prompt).trim()}>
						<Copy size={14} /> Copy Prompt
					</Button>
				</div>
			</div>

			<div className="img-atelier__shell">
				<aside className="img-atelier__prompt p-4 space-y-3">
					<div>
						<h2 className="font-display text-lg font-semibold">Prompt Studio</h2>
						<p className="text-[11px] text-muted-foreground">Shape subject, style chips, and assets.</p>
					</div>

					<form onSubmit={generate} className="space-y-3">
						<Section id="prompt" open={openSections.prompt} onToggle={toggleSection}>
							<Textarea
								label="Prompt"
								rows={5}
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								placeholder="Creamy garlic pasta on a rustic table, steam rising, warm window light"
							/>
							<p className="text-[11px] text-muted-foreground text-right">{prompt.length} characters</p>
						</Section>

						<Section id="styles" open={openSections.styles} onToggle={toggleSection}>
							<p className="text-[11px] text-muted-foreground -mt-1">Chips only help compose the prompt — generation API stays the same.</p>
							<div className="img-chips">
								{QUICK_STYLES.map((style) => (
									<button
										key={style}
										type="button"
										className={`img-chip ${activeStyles.includes(style) ? 'is-active' : ''}`}
										onClick={() => toggleStyle(style)}
									>
										{style}
									</button>
								))}
							</div>
						</Section>

						<Section id="settings" open={openSections.settings} onToggle={toggleSection}>
							<div>
								<p className="mb-1.5 text-sm font-medium">Aspect Ratio</p>
								<div className="img-format-grid">
									{FORMATS.map((f) => (
										<button
											type="button"
											key={f.id}
											onClick={() => setFormat(f.id)}
											className={`img-format ${format === f.id ? 'is-active' : ''}`}
										>
											{f.label}
											<span>{f.ratio}</span>
										</button>
									))}
								</div>
							</div>
							<Select label="Image quality" value={quality} onChange={(e) => setQuality(e.target.value)}>
								<option value="draft">Draft</option>
								<option value="standard">Standard</option>
								<option value="high">High</option>
							</Select>
							<p className="text-[11px] text-muted-foreground -mt-1">UI guide only — does not change OpenAI generation.</p>
							<Select label="Number of images" value={String(imageCount)} onChange={(e) => setImageCount(Number(e.target.value))}>
								{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
							</Select>
							<p className="text-[11px] text-muted-foreground -mt-1">UI only — backend still returns whatever images it generates.</p>
							<Select label="Image style" value={imageStyle} onChange={(e) => setImageStyle(e.target.value)}>
								{['Photographic', 'Editorial', 'Cinematic', 'Illustration', 'Flat lay'].map((style) => (
									<option key={style}>{style}</option>
								))}
							</Select>
							<p className="text-[11px] text-muted-foreground -mt-1">UI only if not wired to generation.</p>
							<label className="img-slider">
								<span className="flex items-center justify-between text-sm font-medium">
									Creativity
									<span className="text-xs text-muted-foreground">{creativity}%</span>
								</span>
								<input type="range" min="0" max="100" value={creativity} onChange={(e) => setCreativity(Number(e.target.value))} />
							</label>
							<label className="img-slider">
								<span className="flex items-center justify-between text-sm font-medium">
									Reference strength
									<span className="text-xs text-muted-foreground">{refStrength}%</span>
								</span>
								<input type="range" min="0" max="100" value={refStrength} onChange={(e) => setRefStrength(Number(e.target.value))} />
								<span className="text-[11px] text-muted-foreground">UI only — not sent to the image backend.</span>
							</label>
						</Section>

						<Section id="assets" open={openSections.assets} onToggle={toggleSection}>
							<Select label="Brand Kit" value={brandKitId} onChange={(e) => setBrandKitId(e.target.value)}>
								<option value="">None</option>
								{brandKits.map((kit) => (
									<option key={kit.id} value={kit.id}>{kit.name}{kit.isDefault ? ' (default)' : ''}</option>
								))}
							</Select>
							<Select label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
								<option value="">None</option>
								{templates.map((template) => (
									<option key={template.id} value={template.id}>{template.name}</option>
								))}
							</Select>
							<div>
								<p className="mb-1.5 text-sm font-medium">Reference image</p>
								<div
									className={`img-dropzone ${dropActive ? 'is-active' : ''}`}
									onDragOver={(e) => { e.preventDefault(); setDropActive(true); }}
									onDragLeave={() => setDropActive(false)}
									onDrop={onDropReference}
								>
									<Upload size={18} className="mx-auto mb-2 text-muted-foreground" />
									<p className="text-xs text-muted-foreground">Drag & drop a hosted image URL, or paste below.</p>
								</div>
								<Input
									className="mt-2"
									value={referenceUrl}
									onChange={(e) => setReferenceUrl(e.target.value)}
									placeholder="https://… (UI only, no upload backend)"
								/>
							</div>
						</Section>

						<Button type="submit" disabled={loading} className="w-full">
							{loading ? (
								<><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
							) : (
								<><Wand2 size={16} /> Generate image</>
							)}
						</Button>
					</form>
				</aside>

				<section className="img-atelier__gallery p-4 sm:p-5 space-y-5">
					<div className="flex items-end justify-between gap-3">
						<div>
							<h2 className="font-display text-lg font-semibold">Image Gallery</h2>
							<p className="text-[11px] text-muted-foreground">
								{loading ? 'Generating…' : `${gallery.length} image${gallery.length === 1 ? '' : 's'} in session`}
							</p>
						</div>
						{fmt ? <Badge>{fmt.label} · {fmt.ratio}</Badge> : null}
					</div>

					{loading ? (
						<div>
							<div className="img-progress">
								{GEN_STEPS.map((step, index) => {
									const state = index < genStep ? 'is-done' : index === genStep ? 'is-active' : '';
									return (
										<div key={step.id} className={`img-progress__step ${state}`}>
											<span className="img-progress__dot" />
											<span>{step.label}</span>
											{index === genStep ? <span className="ml-auto"><Badge tone="amber">In progress</Badge></span> : null}
											{index < genStep ? <span className="ml-auto text-[11px] text-muted-foreground">Done</span> : null}
										</div>
									);
								})}
							</div>
							<div className="img-grid">
								{[0, 1, 2].map((i) => <div key={i} className="img-skeleton" />)}
							</div>
						</div>
					) : null}

					{!loading && gallery.length === 0 ? (
						<div className="img-empty">
							<div className="img-empty__icon">
								<ImageIcon size={26} strokeWidth={1.6} />
							</div>
							<p className="font-display text-xl font-semibold">Your image studio is ready</p>
							<p className="mt-2 max-w-md text-sm text-muted-foreground">
								Write a prompt, pick an aspect ratio, and generate appetizing Pinterest-ready food imagery.
							</p>
							<Button className="mt-5" onClick={generate} disabled={!prompt.trim()}>
								<Wand2 size={15} /> Start generating
							</Button>
						</div>
					) : null}

					{!loading && gallery.length > 0 ? (
						<div className="img-grid">
							{gallery.map((item) => (
								<div
									key={item.id}
									role="button"
									tabIndex={0}
									className={`img-card ${selectedId === item.id ? 'is-selected' : ''}`}
									onClick={() => setSelectedId(item.id)}
									onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(item.id); }}
								>
									<img src={item.url} alt={item.prompt || 'Generated'} loading="lazy" decoding="async" />
									<div className="img-card__hover">
										<button type="button" title="Download" onClick={(e) => { e.stopPropagation(); downloadImage(item.url); }}>
											<Download size={13} />
										</button>
										<button type="button" title="Save" onClick={(e) => { e.stopPropagation(); savePin(item); }}>
											<Save size={13} />
										</button>
										<button type="button" title="Copy prompt" onClick={(e) => { e.stopPropagation(); copyPrompt(item.prompt); }}>
											<Copy size={13} />
										</button>
									</div>
								</div>
							))}
						</div>
					) : null}

					<div className="pt-2 border-t border-border/70">
						<div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<h3 className="font-display text-base font-semibold">Recent Images</h3>
								<p className="text-[11px] text-muted-foreground">{filteredPins.length} of {pins.length} saved pins</p>
							</div>
							<div className="relative w-full sm:w-56">
								<Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
								<input
									className="w-full rounded-xl border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
									placeholder="Search…"
									value={recentSearch}
									onChange={(e) => setRecentSearch(e.target.value)}
								/>
							</div>
						</div>
						<div className="img-filters mb-3">
							{RECENT_FILTERS.map((filter) => (
								<button
									key={filter.id}
									type="button"
									className={`img-filter ${recentFilter === filter.id ? 'is-active' : ''}`}
									onClick={() => setRecentFilter(filter.id)}
								>
									{filter.label}
								</button>
							))}
						</div>
						{filteredPins.length === 0 ? (
							<p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
								No recent images match this filter.
							</p>
						) : (
							<div className="img-recent-grid">
								{filteredPins.map((pin) => (
									<div
										key={pin.id}
										className={`img-recent-card ${selectedId === `pin-${pin.id}` ? 'is-selected' : ''}`}
									>
										<div className="relative">
											<button type="button" className="block w-full" onClick={() => openPinInStudio(pin)}>
												<img src={pin.image_url} alt={pin.title} loading="lazy" decoding="async" />
											</button>
											<button
												type="button"
												className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-card/90 border border-border"
												onClick={() => toggleFavorite(pin.id)}
												aria-label="Toggle favorite"
											>
												<Heart size={13} className={favorites.includes(pin.id) ? 'fill-primary text-primary' : 'text-muted-foreground'} />
											</button>
										</div>
										<button type="button" className="block w-full text-left" onClick={() => openPinInStudio(pin)}>
											<p>{pin.title}</p>
										</button>
									</div>
								))}
							</div>
						)}
					</div>
				</section>

				<aside className="img-atelier__inspector p-4 space-y-3">
					<div>
						<h2 className="font-display text-lg font-semibold">Image Inspector</h2>
						<p className="text-[11px] text-muted-foreground">Preview details and quick actions.</p>
					</div>

					{!selected ? (
						<div className="rounded-2xl border border-dashed border-border bg-background/50 px-4 py-12 text-center">
							<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
								<ImageIcon size={22} />
							</div>
							<p className="font-medium">No image selected</p>
							<p className="mt-1 text-xs text-muted-foreground">Generate or pick an image from the gallery.</p>
						</div>
					) : (
						<>
							<div className="img-preview">
								<img src={selected.url} alt={selected.prompt || 'Selected'} loading="lazy" decoding="async" />
							</div>

							<div className="img-meta">
								<div className="img-meta__row"><span>Aspect ratio</span><span>{selected.ratio || fmt.ratio}</span></div>
								<div className="img-meta__row">
									<span>Generated</span>
									<span>{selected.createdAt ? new Date(selected.createdAt).toLocaleString() : '—'}</span>
								</div>
								<div className="img-meta__row">
									<span className="inline-flex items-center gap-1"><Palette size={12} /> Brand Kit</span>
									<span>{selected.brandKitName || selectedBrand?.name || 'None'}</span>
								</div>
								<div className="img-meta__row">
									<span className="inline-flex items-center gap-1"><LayoutTemplate size={12} /> Template</span>
									<span>{selected.templateName || selectedTemplate?.name || 'None'}</span>
								</div>
								<div className="img-meta__row"><span>Source</span><span>{selected.source === 'library' ? 'Library' : 'Session'}</span></div>
							</div>

							<div>
								<p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Prompt</p>
								<div className="img-prompt-box">{selected.prompt || '—'}</div>
							</div>

							<div className="grid gap-2">
								<Button size="sm" variant="outline" onClick={() => downloadImage(selected.url)}>
									<Download size={14} /> Download
								</Button>
								<Button size="sm" variant="outline" onClick={() => copyPrompt(selected.prompt)}>
									<Copy size={14} /> Copy Prompt
								</Button>
								<Button size="sm" onClick={() => savePin(selected)} disabled={saving}>
									{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save size={14} />}
									Save to Library
								</Button>
								<Link to="/app/ai-pins">
									<Button size="sm" variant="outline" className="w-full">
										<Pin size={14} /> Use in AI Pins
									</Button>
								</Link>
								<Button
									size="sm"
									variant="outline"
									onClick={() => toast({
										title: 'Featured image (UI)',
										description: 'Selection noted. Featured-image wiring stays with the existing article workflow.',
									})}
								>
									<Star size={14} /> Use as Featured Image
								</Button>
								<Button size="sm" variant="ghost" onClick={deleteSelected}>
									<Trash2 size={14} /> Delete
								</Button>
							</div>
						</>
					)}
				</aside>
			</div>
		</div>
	);
}
