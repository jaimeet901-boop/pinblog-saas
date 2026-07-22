import { useEffect, useMemo, useState } from 'react';
import {
	Copy, Plus, Save, Star, Trash2, Search, ChevronDown, LayoutTemplate,
	Type, Palette, Image as ImageIcon, Layers, MapPin, Sparkles, SlidersHorizontal,
	Maximize2, Ratio,
} from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import { Badge, Button, Input, Select, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import TemplatePreviewCard from '@/components/ai-pins/TemplatePreviewCard';
import {
	createDefaultTemplateConfig,
	createTemplateThumbnail,
	normalizeTemplateConfig,
	PINTEREST_CANVAS_PRESETS,
	TEMPLATE_VARIABLES,
} from '@/lib/pinTemplates';
import './TemplatesPage.css';

const SECTIONS = [
	{ id: 'canvas', label: 'Canvas', icon: Ratio },
	{ id: 'typography', label: 'Typography', icon: Type },
	{ id: 'colors', label: 'Colors', icon: Palette },
	{ id: 'background', label: 'Background', icon: ImageIcon },
	{ id: 'overlay', label: 'Overlay', icon: Layers },
	{ id: 'logo', label: 'Logo', icon: LayoutTemplate },
	{ id: 'positioning', label: 'Positioning', icon: MapPin },
	{ id: 'effects', label: 'Effects', icon: Sparkles },
	{ id: 'advanced', label: 'Advanced', icon: SlidersHorizontal },
];

function mapTemplate(record) {
	return {
		id: record.id,
		name: record.name,
		thumbnail: record.thumbnail || '',
		configuration: normalizeTemplateConfig(record.configuration || {}),
		isDefault: Boolean(record.is_default),
		createdAt: record.created,
		updatedAt: record.updated,
	};
}

async function clearDefault(ownerId, exceptId = '') {
	const templates = await pb.collection('ai_pin_templates').getFullList({
		filter: pb.filter('owner = {:owner}', { owner: ownerId }),
	});
	await Promise.all(
		templates
			.filter((template) => template.id !== exceptId && template.is_default)
			.map((template) => pb.collection('ai_pin_templates').update(template.id, { is_default: false })),
	);
}

function Section({ id, open, onToggle, children }) {
	const meta = SECTIONS.find((item) => item.id === id);
	const Icon = meta?.icon || SlidersHorizontal;
	return (
		<div className="tpl-section">
			<button type="button" className="tpl-section__head" onClick={() => onToggle(id)} aria-expanded={open}>
				<span className="inline-flex items-center gap-2">
					<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Icon size={14} />
					</span>
					{meta?.label || id}
				</span>
				<ChevronDown size={16} className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
			</button>
			{open ? <div className="tpl-section__body">{children}</div> : null}
		</div>
	);
}

function FieldHint({ children }) {
	return <p className="text-[11px] text-muted-foreground">{children}</p>;
}

export default function TemplatesPage() {
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [templates, setTemplates] = useState([]);
	const [selectedTemplateId, setSelectedTemplateId] = useState('');
	const [draftName, setDraftName] = useState('New Template');
	const [draftConfig, setDraftConfig] = useState(createDefaultTemplateConfig());
	const [isDefault, setIsDefault] = useState(false);
	const [search, setSearch] = useState('');
	const [previewZoom, setPreviewZoom] = useState('fit');
	const [openSections, setOpenSections] = useState({
		canvas: true,
		typography: true,
		colors: false,
		background: true,
		overlay: false,
		logo: false,
		positioning: false,
		effects: false,
		advanced: false,
	});

	const selectedTemplate = useMemo(
		() => templates.find((template) => template.id === selectedTemplateId) || null,
		[templates, selectedTemplateId],
	);

	const filteredTemplates = useMemo(() => {
		const query = search.trim().toLowerCase();
		if (!query) return templates;
		return templates.filter((template) => template.name.toLowerCase().includes(query));
	}, [templates, search]);

	const isDirty = useMemo(() => {
		if (!selectedTemplate) {
			const blank = createDefaultTemplateConfig();
			return draftName !== 'New Template'
				|| isDefault
				|| JSON.stringify(normalizeTemplateConfig(draftConfig)) !== JSON.stringify(blank);
		}
		return draftName !== selectedTemplate.name
			|| Boolean(isDefault) !== Boolean(selectedTemplate.isDefault)
			|| JSON.stringify(normalizeTemplateConfig(draftConfig)) !== JSON.stringify(normalizeTemplateConfig(selectedTemplate.configuration));
	}, [selectedTemplate, draftName, draftConfig, isDefault]);

	const loadTemplates = async () => {
		setLoading(true);
		try {
			const owner = pb.authStore.record?.id;
			const records = await pb.collection('ai_pin_templates').getFullList({
				sort: '-is_default,-updated',
				filter: pb.filter('owner = {:owner}', { owner }),
			});
			const mapped = records.map(mapTemplate);
			setTemplates(mapped);
			if (mapped.length > 0) {
				const preferred = mapped.find((template) => template.isDefault) || mapped[0];
				setSelectedTemplateId(preferred.id);
				setDraftName(preferred.name);
				setDraftConfig(normalizeTemplateConfig(preferred.configuration));
				setIsDefault(Boolean(preferred.isDefault));
			}
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		loadTemplates();
	}, []);

	const handleCreateNew = () => {
		setSelectedTemplateId('');
		setDraftName('New Template');
		setDraftConfig(createDefaultTemplateConfig());
		setIsDefault(false);
	};

	const handleSelectTemplate = (templateId) => {
		const template = templates.find((item) => item.id === templateId);
		if (!template) {
			return;
		}
		setSelectedTemplateId(template.id);
		setDraftName(template.name);
		setDraftConfig(normalizeTemplateConfig(template.configuration));
		setIsDefault(Boolean(template.isDefault));
	};

	const updatePath = (path, value) => {
		setDraftConfig((prev) => {
			const next = structuredClone(prev);
			let cursor = next;
			for (let i = 0; i < path.length - 1; i += 1) {
				cursor = cursor[path[i]];
			}
			cursor[path[path.length - 1]] = value;
			return normalizeTemplateConfig(next);
		});
	};

	const toggleSection = (id) => {
		setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
	};

	const saveTemplate = async () => {
		if (!draftName.trim()) {
			toast({ variant: 'destructive', title: 'Name required', description: 'Please enter a template name.' });
			return;
		}

		setSaving(true);
		try {
			const owner = pb.authStore.record?.id;
			if (!owner) {
				throw new Error('You must be authenticated');
			}

			if (isDefault) {
				await clearDefault(owner, selectedTemplateId || '');
			}

			const payload = {
				owner,
				name: draftName.trim(),
				thumbnail: createTemplateThumbnail(draftConfig),
				configuration: normalizeTemplateConfig(draftConfig),
				is_default: isDefault,
			};

			if (selectedTemplateId) {
				await pb.collection('ai_pin_templates').update(selectedTemplateId, payload);
				toast({ title: 'Template updated', description: 'Your template was saved successfully.' });
			} else {
				const created = await pb.collection('ai_pin_templates').create(payload);
				setSelectedTemplateId(created.id);
				toast({ title: 'Template created', description: 'A new pin template has been created.' });
			}

			await loadTemplates();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Save failed', description: error.message });
		} finally {
			setSaving(false);
		}
	};

	const duplicateTemplate = async (template) => {
		try {
			const owner = pb.authStore.record?.id;
			const payload = {
				owner,
				name: `${template.name} Copy`,
				thumbnail: template.thumbnail,
				configuration: normalizeTemplateConfig(template.configuration),
				is_default: false,
			};
			await pb.collection('ai_pin_templates').create(payload);
			toast({ title: 'Template duplicated' });
			await loadTemplates();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Duplicate failed', description: error.message });
		}
	};

	const deleteTemplate = async (template) => {
		try {
			await pb.collection('ai_pin_templates').delete(template.id);
			toast({ title: 'Template deleted' });
			if (selectedTemplateId === template.id) {
				handleCreateNew();
			}
			await loadTemplates();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Delete failed', description: error.message });
		}
	};

	const setDefaultTemplate = async (template) => {
		try {
			const owner = pb.authStore.record?.id;
			await clearDefault(owner, template.id);
			await pb.collection('ai_pin_templates').update(template.id, { is_default: true });
			toast({ title: 'Default template updated' });
			await loadTemplates();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Failed', description: error.message });
		}
	};

	useEffect(() => {
		const onKeyDown = (event) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				if (!saving) {
					saveTemplate();
				}
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [saving, selectedTemplateId, draftName, draftConfig, isDefault]);

	return (
		<div className="tpl-atelier">
			<div className="mb-4">
				<p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Chef IA Studio</p>
				<h1 className="font-display text-3xl font-semibold tracking-tight">Pin Templates</h1>
				<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
					Organize reusable pin layouts for AI Pins — edit once, apply everywhere, preview as you go.
				</p>
			</div>

			<div className="tpl-atelier__actions">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm font-medium">{selectedTemplate ? selectedTemplate.name : 'New template'}</span>
					{isDirty ? (
						<span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
							Unsaved changes
						</span>
					) : (
						<span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground">Saved</span>
					)}
					<span className="hidden text-[11px] text-muted-foreground sm:inline">Ctrl+S to save</span>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button size="sm" onClick={saveTemplate} disabled={saving}>
						{saving ? <Spinner className="h-4 w-4" /> : <Save size={14} />}
						Save Template
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={!selectedTemplate}
						onClick={() => selectedTemplate && duplicateTemplate(selectedTemplate)}
					>
						<Copy size={14} /> Duplicate
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={!selectedTemplate}
						onClick={() => selectedTemplate && setDefaultTemplate(selectedTemplate)}
					>
						<Star size={14} /> Set as Default
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={!selectedTemplate}
						onClick={() => selectedTemplate && deleteTemplate(selectedTemplate)}
					>
						<Trash2 size={14} /> Delete
					</Button>
				</div>
			</div>

			{loading ? (
				<div className="tpl-atelier__shell">
					<div className="tpl-atelier__list space-y-3 p-4">
						{[0, 1, 2, 3].map((item) => <div key={item} className="tpl-skeleton" />)}
					</div>
					<div className="tpl-atelier__editor space-y-3 p-4">
						{[0, 1, 2].map((item) => <div key={item} className="tpl-skeleton" style={{ height: '6rem' }} />)}
					</div>
					<div className="tpl-atelier__preview p-4">
						<div className="tpl-skeleton" style={{ height: '22rem' }} />
					</div>
				</div>
			) : (
				<div className="tpl-atelier__shell">
					<aside className="tpl-atelier__list p-4">
						<div className="mb-3 flex items-center justify-between gap-2">
							<div>
								<h2 className="font-display text-lg font-semibold">Templates</h2>
								<p className="text-[11px] text-muted-foreground">{templates.length} saved</p>
							</div>
							<Button size="sm" onClick={handleCreateNew}><Plus size={14} /> New</Button>
						</div>

						<div className="relative mb-3">
							<Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
							<input
								className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
								placeholder="Search templates…"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
							/>
						</div>

						{filteredTemplates.length === 0 ? (
							<div className="rounded-2xl border border-dashed border-border bg-background/50 px-4 py-10 text-center">
								<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
									<LayoutTemplate size={22} />
								</div>
								<p className="font-medium">{templates.length === 0 ? 'No templates yet' : 'No matches'}</p>
								<p className="mt-1 text-xs text-muted-foreground">
									{templates.length === 0
										? 'Create your first pin template to standardize AI Pins layouts.'
										: 'Try another search term.'}
								</p>
								{templates.length === 0 ? (
									<Button size="sm" className="mt-4" onClick={handleCreateNew}><Plus size={14} /> New Template</Button>
								) : null}
							</div>
						) : (
							<div className="space-y-2">
								{!selectedTemplateId ? (
									<div className="tpl-card is-selected">
										<p className="text-sm font-semibold">New Template</p>
										<p className="mt-1 text-[11px] text-muted-foreground">Draft — not saved yet</p>
									</div>
								) : null}
								{filteredTemplates.map((template) => (
									<button
										key={template.id}
										type="button"
										className={`tpl-card ${selectedTemplateId === template.id ? 'is-selected' : ''}`}
										onClick={() => handleSelectTemplate(template.id)}
									>
										<div className="flex gap-3">
											<div className="tpl-card__thumb">
												{template.thumbnail ? (
													<img src={template.thumbnail} alt="" loading="lazy" />
												) : (
													<div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">N/A</div>
												)}
											</div>
											<div className="min-w-0 flex-1">
												<div className="flex items-start justify-between gap-2">
													<p className="truncate text-sm font-semibold">{template.name}</p>
													{template.isDefault ? <Badge tone="green">Default</Badge> : null}
												</div>
												<p className="mt-1 text-[11px] text-muted-foreground">
													Updated {new Date(template.updatedAt).toLocaleDateString()}
												</p>
												<p className="mt-1 text-[10px] text-muted-foreground">
													{template.configuration.canvas.width}×{template.configuration.canvas.height}
												</p>
											</div>
										</div>
									</button>
								))}
							</div>
						)}
					</aside>

					<section className="tpl-atelier__editor p-4 sm:p-5">
						<div className="mb-4 space-y-3">
							<Input label="Template name" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
							<label className="tpl-switch">
								<input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
								Set as default template for AI Pins
							</label>
						</div>

						<div className="space-y-3">
							<Section id="canvas" open={openSections.canvas} onToggle={toggleSection}>
								<Select
									label="Canvas size"
									value={`${draftConfig.canvas.width}x${draftConfig.canvas.height}`}
									onChange={(e) => {
										const [width, height] = e.target.value.split('x').map((value) => Number(value));
										updatePath(['canvas', 'width'], width);
										updatePath(['canvas', 'height'], height);
									}}
								>
									{PINTEREST_CANVAS_PRESETS.map((preset) => (
										<option key={`${preset.width}x${preset.height}`} value={`${preset.width}x${preset.height}`}>
											{preset.label}
										</option>
									))}
								</Select>
								<FieldHint>Pinterest-friendly presets used when generating pins.</FieldHint>
							</Section>

							<Section id="typography" open={openSections.typography} onToggle={toggleSection}>
								<Input label="Font family" value={draftConfig.typography.fontFamily} onChange={(e) => updatePath(['typography', 'fontFamily'], e.target.value)} />
								<div className="grid grid-cols-2 gap-3">
									<label className="block">
										<span className="mb-1.5 block text-sm font-medium">Font size ({draftConfig.typography.fontSize})</span>
										<input className="tpl-range" type="range" min="12" max="140" value={draftConfig.typography.fontSize} onChange={(e) => updatePath(['typography', 'fontSize'], Number(e.target.value))} />
									</label>
									<label className="block">
										<span className="mb-1.5 block text-sm font-medium">Font weight ({draftConfig.typography.fontWeight})</span>
										<input className="tpl-range" type="range" min="300" max="900" step="100" value={draftConfig.typography.fontWeight} onChange={(e) => updatePath(['typography', 'fontWeight'], Number(e.target.value))} />
									</label>
								</div>
								<Input label="Text color" type="color" value={draftConfig.typography.textColor} onChange={(e) => updatePath(['typography', 'textColor'], e.target.value)} />
							</Section>

							<Section id="colors" open={openSections.colors} onToggle={toggleSection}>
								<div className="grid grid-cols-2 gap-3">
									<Input label="Background color" type="color" value={draftConfig.background.color} onChange={(e) => updatePath(['background', 'color'], e.target.value)} />
									<Input label="Text color" type="color" value={draftConfig.typography.textColor} onChange={(e) => updatePath(['typography', 'textColor'], e.target.value)} />
									<Input label="Overlay background" type="color" value={draftConfig.buttonStyle.background} onChange={(e) => updatePath(['buttonStyle', 'background'], e.target.value)} />
									<Input label="Overlay text" type="color" value={draftConfig.buttonStyle.textColor} onChange={(e) => updatePath(['buttonStyle', 'textColor'], e.target.value)} />
								</div>
							</Section>

							<Section id="background" open={openSections.background} onToggle={toggleSection}>
								<Input label="Background color" type="color" value={draftConfig.background.color} onChange={(e) => updatePath(['background', 'color'], e.target.value)} />
								<Input label="Background image URL" value={draftConfig.background.imageUrl} onChange={(e) => updatePath(['background', 'imageUrl'], e.target.value)} placeholder="https://..." />
								<label className="block">
									<span className="mb-1.5 block text-sm font-medium">Background opacity ({draftConfig.background.opacity})</span>
									<input className="tpl-range" type="range" min="0" max="1" step="0.05" value={draftConfig.background.opacity} onChange={(e) => updatePath(['background', 'opacity'], Number(e.target.value))} />
								</label>
								<label className="tpl-switch">
									<input type="checkbox" checked={draftConfig.placeholders.backgroundPattern} onChange={(e) => updatePath(['placeholders', 'backgroundPattern'], e.target.checked)} />
									Show background pattern
								</label>
								<label className="tpl-switch">
									<input type="checkbox" checked={draftConfig.placeholders.featuredImage} onChange={(e) => updatePath(['placeholders', 'featuredImage'], e.target.checked)} />
									Reserve featured image area
								</label>
							</Section>

							<Section id="overlay" open={openSections.overlay} onToggle={toggleSection}>
								<div className="grid grid-cols-2 gap-3">
									<label className="block">
										<span className="mb-1.5 block text-sm font-medium">Button radius ({draftConfig.buttonStyle.borderRadius})</span>
										<input className="tpl-range" type="range" min="0" max="80" value={draftConfig.buttonStyle.borderRadius} onChange={(e) => updatePath(['buttonStyle', 'borderRadius'], Number(e.target.value))} />
									</label>
									<label className="block">
										<span className="mb-1.5 block text-sm font-medium">Button padding ({draftConfig.buttonStyle.padding})</span>
										<input className="tpl-range" type="range" min="0" max="64" value={draftConfig.buttonStyle.padding} onChange={(e) => updatePath(['buttonStyle', 'padding'], Number(e.target.value))} />
									</label>
								</div>
								<label className="block">
									<span className="mb-1.5 block text-sm font-medium">Overlay opacity ({draftConfig.buttonStyle.opacity})</span>
									<input className="tpl-range" type="range" min="0" max="1" step="0.05" value={draftConfig.buttonStyle.opacity} onChange={(e) => updatePath(['buttonStyle', 'opacity'], Number(e.target.value))} />
								</label>
								<label className="tpl-switch">
									<input type="checkbox" checked={draftConfig.buttonStyle.shadow} onChange={(e) => updatePath(['buttonStyle', 'shadow'], e.target.checked)} />
									Overlay shadow
								</label>
								<div className="grid grid-cols-2 gap-3">
									<Input label="Overlay position X" type="number" value={draftConfig.positions.overlayText.x} onChange={(e) => updatePath(['positions', 'overlayText', 'x'], Number(e.target.value))} />
									<Input label="Overlay position Y" type="number" value={draftConfig.positions.overlayText.y} onChange={(e) => updatePath(['positions', 'overlayText', 'y'], Number(e.target.value))} />
								</div>
							</Section>

							<Section id="logo" open={openSections.logo} onToggle={toggleSection}>
								<label className="tpl-switch">
									<input type="checkbox" checked={draftConfig.placeholders.websiteLogo} onChange={(e) => updatePath(['placeholders', 'websiteLogo'], e.target.checked)} />
									Show website logo placeholder
								</label>
								<div className="grid grid-cols-2 gap-3">
									<Input label="Logo position X" type="number" value={draftConfig.positions.logo.x} onChange={(e) => updatePath(['positions', 'logo', 'x'], Number(e.target.value))} />
									<Input label="Logo position Y" type="number" value={draftConfig.positions.logo.y} onChange={(e) => updatePath(['positions', 'logo', 'y'], Number(e.target.value))} />
								</div>
							</Section>

							<Section id="positioning" open={openSections.positioning} onToggle={toggleSection}>
								<div className="grid grid-cols-2 gap-3">
									<Input label="Title X" type="number" value={draftConfig.positions.title.x} onChange={(e) => updatePath(['positions', 'title', 'x'], Number(e.target.value))} />
									<Input label="Title Y" type="number" value={draftConfig.positions.title.y} onChange={(e) => updatePath(['positions', 'title', 'y'], Number(e.target.value))} />
									<Input label="Description X" type="number" value={draftConfig.positions.description.x} onChange={(e) => updatePath(['positions', 'description', 'x'], Number(e.target.value))} />
									<Input label="Description Y" type="number" value={draftConfig.positions.description.y} onChange={(e) => updatePath(['positions', 'description', 'y'], Number(e.target.value))} />
									<Input label="Overlay X" type="number" value={draftConfig.positions.overlayText.x} onChange={(e) => updatePath(['positions', 'overlayText', 'x'], Number(e.target.value))} />
									<Input label="Overlay Y" type="number" value={draftConfig.positions.overlayText.y} onChange={(e) => updatePath(['positions', 'overlayText', 'y'], Number(e.target.value))} />
									<Input label="Logo X" type="number" value={draftConfig.positions.logo.x} onChange={(e) => updatePath(['positions', 'logo', 'x'], Number(e.target.value))} />
									<Input label="Logo Y" type="number" value={draftConfig.positions.logo.y} onChange={(e) => updatePath(['positions', 'logo', 'y'], Number(e.target.value))} />
								</div>
								<FieldHint>Positions are percentages of the canvas (0–100).</FieldHint>
							</Section>

							<Section id="effects" open={openSections.effects} onToggle={toggleSection}>
								<label className="block">
									<span className="mb-1.5 block text-sm font-medium">Container padding ({draftConfig.container.padding})</span>
									<input className="tpl-range" type="range" min="0" max="120" value={draftConfig.container.padding} onChange={(e) => updatePath(['container', 'padding'], Number(e.target.value))} />
								</label>
								<label className="block">
									<span className="mb-1.5 block text-sm font-medium">Container radius ({draftConfig.container.borderRadius})</span>
									<input className="tpl-range" type="range" min="0" max="120" value={draftConfig.container.borderRadius} onChange={(e) => updatePath(['container', 'borderRadius'], Number(e.target.value))} />
								</label>
								<label className="block">
									<span className="mb-1.5 block text-sm font-medium">Container opacity ({draftConfig.container.opacity})</span>
									<input className="tpl-range" type="range" min="0.05" max="1" step="0.05" value={draftConfig.container.opacity} onChange={(e) => updatePath(['container', 'opacity'], Number(e.target.value))} />
								</label>
								<label className="tpl-switch">
									<input type="checkbox" checked={draftConfig.container.shadow} onChange={(e) => updatePath(['container', 'shadow'], e.target.checked)} />
									Pin shadow
								</label>
							</Section>

							<Section id="advanced" open={openSections.advanced} onToggle={toggleSection}>
								<div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
									<p className="font-medium text-foreground">Dynamic variables</p>
									<p className="mt-1">{TEMPLATE_VARIABLES.join(' • ')}</p>
									<p className="mt-2">Image placeholders: Featured Image, Website Logo, Background Pattern.</p>
								</div>
								<div className="grid grid-cols-2 gap-3">
									<Input label="Canvas width" type="number" value={draftConfig.canvas.width} onChange={(e) => updatePath(['canvas', 'width'], Number(e.target.value))} />
									<Input label="Canvas height" type="number" value={draftConfig.canvas.height} onChange={(e) => updatePath(['canvas', 'height'], Number(e.target.value))} />
								</div>
								<FieldHint>Advanced size overrides still use the same saved configuration shape.</FieldHint>
							</Section>
						</div>
					</section>

					<aside className="tpl-atelier__preview p-4">
						<div className="mb-3 flex items-center justify-between gap-2">
							<div>
								<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Live preview</p>
								<h3 className="font-display text-lg font-semibold">Pinterest pin</h3>
							</div>
							<div className="flex rounded-xl border border-border bg-background/70 p-1">
								<button
									type="button"
									className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${previewZoom === 'fit' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
									onClick={() => setPreviewZoom('fit')}
								>
									Fit
								</button>
								<button
									type="button"
									className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${previewZoom === '100' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
									onClick={() => setPreviewZoom('100')}
								>
									<Maximize2 size={11} /> 100%
								</button>
							</div>
						</div>

						<div className="tpl-preview-stage">
							<div className={`tpl-preview-frame ${previewZoom === '100' ? 'is-100' : 'is-fit'}`}>
								<TemplatePreviewCard
									config={draftConfig}
									className="shadow-none"
									context={{
										title: 'Weeknight Pasta Bowl',
										description: 'Fast, comforting dinner ideas for busy evenings.',
										category: 'Recipes',
										website: 'chefia.studio',
										author: 'Chef IA',
										overlayText: 'Save Recipe',
									}}
								/>
							</div>
						</div>

						<p className="mt-3 text-center text-[11px] text-muted-foreground">
							Updates live as you edit · {draftConfig.canvas.width}×{draftConfig.canvas.height}
						</p>
					</aside>
				</div>
			)}
		</div>
	);
}
