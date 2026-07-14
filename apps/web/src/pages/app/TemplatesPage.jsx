import { useEffect, useMemo, useState } from 'react';
import { Copy, Plus, Save, Star, Trash2 } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import TemplatePreviewCard from '@/components/ai-pins/TemplatePreviewCard';
import {
	createDefaultTemplateConfig,
	createTemplateThumbnail,
	normalizeTemplateConfig,
	PINTEREST_CANVAS_PRESETS,
	TEMPLATE_VARIABLES,
} from '@/lib/pinTemplates';

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

export default function TemplatesPage() {
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [templates, setTemplates] = useState([]);
	const [selectedTemplateId, setSelectedTemplateId] = useState('');
	const [draftName, setDraftName] = useState('New Template');
	const [draftConfig, setDraftConfig] = useState(createDefaultTemplateConfig());
	const [isDefault, setIsDefault] = useState(false);

	const selectedTemplate = useMemo(
		() => templates.find((template) => template.id === selectedTemplateId) || null,
		[templates, selectedTemplateId],
	);

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

	const saveTemplate = async () => {
		if (!draftName.trim()) {
			toast({ variant: 'destructive', title: 'Name required', description: 'Please enter a template name.' });
			return;
		}
+
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

	return (
		<div>
			<PageHeader
				title="Templates"
				subtitle="Build reusable Pinterest pin templates and apply them during AI Pin generation."
				action={<Button onClick={handleCreateNew}><Plus size={16} /> New Template</Button>}
			/>

			{loading ? (
				<div className="flex items-center justify-center py-10 text-muted-foreground"><Spinner className="mr-2 h-4 w-4" /> Loading templates...</div>
			) : (
				<div className="grid gap-4 lg:grid-cols-12">
					<Card className="lg:col-span-4 space-y-3">
						<h3 className="font-semibold">Saved Templates</h3>
						{templates.length === 0 ? (
							<Empty title="No templates yet" subtitle="Create your first template to standardize pin designs." />
						) : (
							templates.map((template) => (
								<button
									key={template.id}
									type="button"
									onClick={() => handleSelectTemplate(template.id)}
									className={`w-full rounded-xl border p-3 text-left ${selectedTemplateId === template.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/30'}`}
								>
									<div className="flex items-center justify-between">
										<p className="font-medium truncate">{template.name}</p>
										{template.isDefault ? <Badge tone="green">Default</Badge> : null}
									</div>
									<p className="mt-1 text-xs text-muted-foreground">Updated {new Date(template.updatedAt).toLocaleString()}</p>
									<div className="mt-2 flex gap-2">
										<Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); duplicateTemplate(template); }}><Copy size={13} /> Duplicate</Button>
										<Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); setDefaultTemplate(template); }}><Star size={13} /> Default</Button>
										<Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); deleteTemplate(template); }}><Trash2 size={13} /></Button>
									</div>
								</button>
							))
						)}
					</Card>

					<Card className="lg:col-span-8">
						<div className="grid gap-4 lg:grid-cols-2">
							<div className="space-y-3">
								<Input label="Template Name" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
								<Select
									label="Canvas Size"
									value={`${draftConfig.canvas.width}x${draftConfig.canvas.height}`}
									onChange={(e) => {
										const [width, height] = e.target.value.split('x').map((value) => Number(value));
										updatePath(['canvas', 'width'], width);
										updatePath(['canvas', 'height'], height);
									}}
								>
									{PINTEREST_CANVAS_PRESETS.map((preset) => (
										<option key={`${preset.width}x${preset.height}`} value={`${preset.width}x${preset.height}`}>{preset.label}</option>
									))}
								</Select>
								<div className="grid grid-cols-2 gap-3">
									<Input label="Background Color" type="color" value={draftConfig.background.color} onChange={(e) => updatePath(['background', 'color'], e.target.value)} />
									<Input label="Background Image URL" value={draftConfig.background.imageUrl} onChange={(e) => updatePath(['background', 'imageUrl'], e.target.value)} placeholder="https://..." />
								</div>
								<div className="grid grid-cols-2 gap-3">
									<Input label="Font Family" value={draftConfig.typography.fontFamily} onChange={(e) => updatePath(['typography', 'fontFamily'], e.target.value)} />
									<Input label="Font Size" type="number" value={draftConfig.typography.fontSize} onChange={(e) => updatePath(['typography', 'fontSize'], Number(e.target.value))} />
								</div>
								<div className="grid grid-cols-2 gap-3">
									<Input label="Font Weight" type="number" value={draftConfig.typography.fontWeight} onChange={(e) => updatePath(['typography', 'fontWeight'], Number(e.target.value))} />
									<Input label="Text Color" type="color" value={draftConfig.typography.textColor} onChange={(e) => updatePath(['typography', 'textColor'], e.target.value)} />
								</div>
								<div className="grid grid-cols-2 gap-3">
									<Input label="Button Radius" type="number" value={draftConfig.buttonStyle.borderRadius} onChange={(e) => updatePath(['buttonStyle', 'borderRadius'], Number(e.target.value))} />
									<Input label="Padding" type="number" value={draftConfig.container.padding} onChange={(e) => updatePath(['container', 'padding'], Number(e.target.value))} />
								</div>
								<div className="grid grid-cols-2 gap-3">
									<Input label="Opacity" type="number" min="0" max="1" step="0.05" value={draftConfig.container.opacity} onChange={(e) => updatePath(['container', 'opacity'], Number(e.target.value))} />
									<Input label="Shadow" value={draftConfig.container.shadow ? 'on' : 'off'} onChange={(e) => updatePath(['container', 'shadow'], e.target.value === 'on')} placeholder="on / off" />
								</div>
								<div className="grid grid-cols-2 gap-3">
									<Input label="Title Position X" type="number" value={draftConfig.positions.title.x} onChange={(e) => updatePath(['positions', 'title', 'x'], Number(e.target.value))} />
									<Input label="Title Position Y" type="number" value={draftConfig.positions.title.y} onChange={(e) => updatePath(['positions', 'title', 'y'], Number(e.target.value))} />
								</div>
								<div className="grid grid-cols-2 gap-3">
									<Input label="Description Position" type="number" value={draftConfig.positions.description.y} onChange={(e) => updatePath(['positions', 'description', 'y'], Number(e.target.value))} />
									<Input label="Overlay Position" type="number" value={draftConfig.positions.overlayText.y} onChange={(e) => updatePath(['positions', 'overlayText', 'y'], Number(e.target.value))} />
								</div>
								<div className="grid grid-cols-2 gap-3">
									<Input label="Logo Position X" type="number" value={draftConfig.positions.logo.x} onChange={(e) => updatePath(['positions', 'logo', 'x'], Number(e.target.value))} />
									<Input label="Logo Position Y" type="number" value={draftConfig.positions.logo.y} onChange={(e) => updatePath(['positions', 'logo', 'y'], Number(e.target.value))} />
								</div>
								<div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
									<p className="font-medium text-foreground">Dynamic Variables</p>
									<p className="mt-1">{TEMPLATE_VARIABLES.join(' • ')}</p>
									<p className="mt-2">Image placeholders: Featured Image, Website Logo, Background Pattern.</p>
								</div>
								<div className="flex gap-2">
									<Button variant="outline" onClick={() => setIsDefault((prev) => !prev)}>{isDefault ? <Star size={14} /> : <Star size={14} />} {isDefault ? 'Default Enabled' : 'Set as Default'}</Button>
									<Button onClick={saveTemplate} disabled={saving}>{saving ? <Spinner className="h-4 w-4" /> : <Save size={14} />} Save Template</Button>
								</div>
							</div>
							<div>
								<p className="mb-2 font-semibold">Template Preview</p>
								<TemplatePreviewCard
									config={draftConfig}
									context={{
										title: '{{title}}',
										description: '{{description}}',
										category: '{{category}}',
										website: '{{website}}',
										author: '{{author}}',
										overlayText: 'Shop Recipe',
									}}
								/>
							</div>
						</div>
					</Card>
				</div>
			)}
		</div>
	);
}
