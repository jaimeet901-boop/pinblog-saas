import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Palette, Plus, Trash2, Save, Copy, Star, Search, ChevronDown,
	Type, Image as ImageIcon, Settings2, Upload, Wand2,
} from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Input, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import './BrandKitPage.css';

const blank = {
	name: 'My Brand',
	logoUrl: '',
	primaryColor: '#111827',
	secondaryColor: '#F97316',
	accentColor: '#0EA5E9',
	fontHeading: 'Georgia',
	fontBody: 'Inter',
	watermarkText: '',
	watermarkUrl: '',
	websiteUrl: '',
	isDefault: true,
};

const SECTIONS = [
	{ id: 'basic', label: 'Basic Information', icon: Settings2 },
	{ id: 'colors', label: 'Brand Colors', icon: Palette },
	{ id: 'typography', label: 'Typography', icon: Type },
	{ id: 'assets', label: 'Logo & Watermark', icon: ImageIcon },
	{ id: 'settings', label: 'Settings', icon: Star },
];

function toForm(item) {
	return {
		name: item.name || 'My Brand',
		logoUrl: item.logoUrl || '',
		primaryColor: item.primaryColor || '#111827',
		secondaryColor: item.secondaryColor || '#F97316',
		accentColor: item.accentColor || '#0EA5E9',
		fontHeading: item.fontHeading || 'Georgia',
		fontBody: item.fontBody || 'Inter',
		watermarkText: item.watermarkText || '',
		watermarkUrl: item.watermarkUrl || '',
		websiteUrl: item.websiteUrl || '',
		isDefault: Boolean(item.isDefault),
	};
}

function Section({ id, open, onToggle, children }) {
	const meta = SECTIONS.find((item) => item.id === id);
	const Icon = meta?.icon || Settings2;
	return (
		<div className="bk-section">
			<button type="button" className="bk-section__head" onClick={() => onToggle(id)} aria-expanded={open}>
				<span className="inline-flex items-center gap-2">
					<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Icon size={14} />
					</span>
					{meta?.label || id}
				</span>
				<ChevronDown size={16} className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
			</button>
			{open ? <div className="bk-section__body">{children}</div> : null}
		</div>
	);
}

function ColorField({ label, value, onChange }) {
	return (
		<label className="block">
			<span className="mb-1.5 block text-sm font-medium">{label}</span>
			<div className="bk-color-row">
				<input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} aria-label={`${label} picker`} />
				<input
					className="w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder="#000000"
				/>
			</div>
		</label>
	);
}

export default function BrandKitPage() {
	const { toast } = useToast();
	const [items, setItems] = useState([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [form, setForm] = useState(blank);
	const [selectedId, setSelectedId] = useState('');
	const [baseline, setBaseline] = useState(blank);
	const [search, setSearch] = useState('');
	const [previewMode, setPreviewMode] = useState('fit');
	const [dropActive, setDropActive] = useState(false);
	const [openSections, setOpenSections] = useState({
		basic: true,
		colors: true,
		typography: true,
		assets: true,
		settings: true,
	});

	const filteredItems = useMemo(() => {
		const query = search.trim().toLowerCase();
		if (!query) return items;
		return items.filter((item) => (
			String(item.name || '').toLowerCase().includes(query)
			|| String(item.websiteUrl || '').toLowerCase().includes(query)
		));
	}, [items, search]);

	const isDirty = useMemo(
		() => JSON.stringify(form) !== JSON.stringify(baseline),
		[form, baseline],
	);

	const load = async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch('/ai-pins/brand-kits', { method: 'GET' });
			const payload = await response.json().catch(() => []);
			if (!response.ok) {
				throw new Error(payload?.message || 'Failed to load brand kits');
			}
			const list = Array.isArray(payload) ? payload : [];
			setItems(list);
			if (selectedId) {
				const stillThere = list.find((item) => item.id === selectedId);
				if (stillThere) {
					const next = toForm(stillThere);
					setForm(next);
					setBaseline(next);
				}
			}
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
	}, []);

	const updateField = (key, value) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	};

	const toggleSection = (id) => {
		setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
	};

	const handleCreateNew = () => {
		setSelectedId('');
		setForm(blank);
		setBaseline(blank);
	};

	const handleSelect = (item) => {
		const next = toForm(item);
		setSelectedId(item.id);
		setForm(next);
		setBaseline(next);
	};

	const save = async (event) => {
		event?.preventDefault?.();
		setSaving(true);
		try {
			const endpoint = selectedId ? `/ai-pins/brand-kits/${selectedId}` : '/ai-pins/brand-kits';
			const method = selectedId ? 'PATCH' : 'POST';
			const response = await apiServerClient.fetch(endpoint, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(form),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || 'Failed to save brand kit');
			}
			toast({ title: selectedId ? 'Brand kit updated' : 'Brand kit saved' });
			if (!selectedId && payload?.id) {
				setSelectedId(payload.id);
				const next = toForm(payload);
				setForm(next);
				setBaseline(next);
			} else {
				setBaseline(form);
			}
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setSaving(false);
		}
	};

	const duplicate = async () => {
		const source = selectedId ? items.find((item) => item.id === selectedId) : null;
		const payload = {
			...(source ? toForm(source) : form),
			name: `${(source?.name || form.name || 'Brand').trim()} Copy`,
			isDefault: false,
		};
		setSaving(true);
		try {
			const response = await apiServerClient.fetch('/ai-pins/brand-kits', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(body?.message || 'Failed to duplicate brand kit');
			}
			toast({ title: 'Brand kit duplicated' });
			if (body?.id) {
				setSelectedId(body.id);
				const next = toForm(body);
				setForm(next);
				setBaseline(next);
			}
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setSaving(false);
		}
	};

	const setAsDefault = async () => {
		if (!selectedId) {
			updateField('isDefault', true);
			toast({ title: 'Default enabled', description: 'Save the brand kit to apply default status.' });
			return;
		}
		setSaving(true);
		try {
			const response = await apiServerClient.fetch(`/ai-pins/brand-kits/${selectedId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...form, isDefault: true }),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || 'Failed to set default');
			}
			toast({ title: 'Default brand kit updated' });
			const next = toForm(payload);
			setForm(next);
			setBaseline(next);
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setSaving(false);
		}
	};

	const remove = async (id) => {
		if (!confirm('Delete this brand kit?')) return;
		try {
			const response = await apiServerClient.fetch(`/ai-pins/brand-kits/${id}`, { method: 'DELETE' });
			if (!response.ok && response.status !== 204) {
				const payload = await response.json().catch(() => ({}));
				throw new Error(payload?.message || 'Failed to delete brand kit');
			}
			toast({ title: 'Brand kit deleted' });
			if (selectedId === id) {
				handleCreateNew();
			}
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		}
	};

	const onDropLogo = (event) => {
		event.preventDefault();
		setDropActive(false);
		const file = event.dataTransfer?.files?.[0];
		const uri = event.dataTransfer?.getData?.('text/uri-list') || event.dataTransfer?.getData?.('text/plain');
		if (uri && /^https?:\/\//i.test(uri.trim())) {
			updateField('logoUrl', uri.trim());
			toast({ title: 'Logo URL applied' });
			return;
		}
		if (file) {
			toast({
				title: 'URL required',
				description: 'File hosting is not available here. Paste a hosted logo URL instead.',
			});
		}
	};

	useEffect(() => {
		const onKeyDown = (event) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				if (!saving) save();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [saving, form, selectedId]);

	return (
		<div className="bk-atelier">
			<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Chef IA Studio</p>
					<h1 className="font-display text-3xl font-semibold tracking-tight">Brand Kit</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Define logo, colors, type, and watermark once — then apply them across AI Pins.
					</p>
				</div>
				<Link to="/app/ai-pins"><Button variant="outline" size="sm"><Wand2 size={14} /> Back to AI Pins</Button></Link>
			</div>

			<div className="bk-atelier__actions">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm font-medium">{selectedId ? form.name : 'New brand kit'}</span>
					{isDirty ? (
						<span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
							Unsaved changes
						</span>
					) : (
						<span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground">Saved</span>
					)}
					<span className="hidden text-[11px] text-muted-foreground sm:inline">Ctrl+S</span>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button size="sm" onClick={save} disabled={saving}>
						{saving ? <Spinner className="h-4 w-4" /> : <Save size={14} />}
						Save Brand Kit
					</Button>
					<Button size="sm" variant="outline" onClick={duplicate} disabled={saving}>
						<Copy size={14} /> Duplicate
					</Button>
					<Button size="sm" variant="outline" onClick={setAsDefault} disabled={saving}>
						<Star size={14} /> Set as Default
					</Button>
					<Button size="sm" variant="ghost" disabled={!selectedId} onClick={() => remove(selectedId)}>
						<Trash2 size={14} /> Delete
					</Button>
				</div>
			</div>

			{loading ? (
				<div className="bk-atelier__shell">
					<div className="bk-atelier__library space-y-3 p-4">{[0, 1, 2].map((i) => <div key={i} className="bk-skeleton" />)}</div>
					<div className="bk-atelier__editor space-y-3 p-4">{[0, 1, 2].map((i) => <div key={i} className="bk-skeleton" style={{ height: '6rem' }} />)}</div>
					<div className="bk-atelier__preview p-4"><div className="bk-skeleton" style={{ height: '22rem' }} /></div>
				</div>
			) : (
				<div className="bk-atelier__shell">
					<aside className="bk-atelier__library p-4">
						<div className="mb-3 flex items-center justify-between gap-2">
							<div>
								<h2 className="font-display text-lg font-semibold">Library</h2>
								<p className="text-[11px] text-muted-foreground">{items.length} kits</p>
							</div>
							<Button size="sm" onClick={handleCreateNew}><Plus size={14} /> New</Button>
						</div>

						<div className="relative mb-3">
							<Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
							<input
								className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
								placeholder="Search brand kits…"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
							/>
						</div>

						{filteredItems.length === 0 ? (
							<div className="rounded-2xl border border-dashed border-border bg-background/50 px-4 py-10 text-center">
								<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
									<Palette size={22} />
								</div>
								<p className="font-medium">{items.length === 0 ? 'No brand kits yet' : 'No matches'}</p>
								<p className="mt-1 text-xs text-muted-foreground">
									{items.length === 0
										? 'Create your first kit to brand AI Pins with your look.'
										: 'Try another search term.'}
								</p>
								{items.length === 0 ? (
									<Button size="sm" className="mt-4" onClick={handleCreateNew}><Plus size={14} /> New Brand Kit</Button>
								) : null}
							</div>
						) : (
							<div className="space-y-2">
								{!selectedId ? (
									<div className="bk-card is-selected">
										<p className="text-sm font-semibold">New Brand Kit</p>
										<p className="mt-1 text-[11px] text-muted-foreground">Draft — not saved yet</p>
									</div>
								) : null}
								{filteredItems.map((item) => (
									<button
										key={item.id}
										type="button"
										className={`bk-card ${selectedId === item.id ? 'is-selected' : ''}`}
										onClick={() => handleSelect(item)}
									>
										<div className="flex gap-3">
											<div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary">
												{item.logoUrl ? (
													<img src={item.logoUrl} alt="" className="h-full w-full object-contain p-1" />
												) : (
													<Palette size={16} className="text-muted-foreground" />
												)}
											</div>
											<div className="min-w-0 flex-1">
												<div className="flex items-start justify-between gap-2">
													<p className="truncate text-sm font-semibold">{item.name}</p>
													{item.isDefault ? <Badge tone="green">Default</Badge> : null}
												</div>
												<p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.websiteUrl || 'No website'}</p>
												<div className="mt-2 flex items-center gap-1.5">
													<span className="bk-swatch" style={{ background: item.primaryColor }} />
													<span className="bk-swatch" style={{ background: item.secondaryColor }} />
													<span className="bk-swatch" style={{ background: item.accentColor }} />
												</div>
											</div>
										</div>
									</button>
								))}
							</div>
						)}
					</aside>

					<section className="bk-atelier__editor p-4 sm:p-5">
						<form onSubmit={save} className="space-y-3">
							<Section id="basic" open={openSections.basic} onToggle={toggleSection}>
								<Input label="Brand name" value={form.name} onChange={(e) => updateField('name', e.target.value)} required />
								<Input label="Website URL" value={form.websiteUrl} onChange={(e) => updateField('websiteUrl', e.target.value)} placeholder="https://…" />
							</Section>

							<Section id="colors" open={openSections.colors} onToggle={toggleSection}>
								<div className="grid gap-3 sm:grid-cols-3">
									<ColorField label="Primary" value={form.primaryColor} onChange={(value) => updateField('primaryColor', value)} />
									<ColorField label="Secondary" value={form.secondaryColor} onChange={(value) => updateField('secondaryColor', value)} />
									<ColorField label="Accent" value={form.accentColor} onChange={(value) => updateField('accentColor', value)} />
								</div>
							</Section>

							<Section id="typography" open={openSections.typography} onToggle={toggleSection}>
								<div className="grid gap-3 sm:grid-cols-2">
									<Input label="Heading font" value={form.fontHeading} onChange={(e) => updateField('fontHeading', e.target.value)} />
									<Input label="Body font" value={form.fontBody} onChange={(e) => updateField('fontBody', e.target.value)} />
								</div>
								<div className="rounded-xl border border-border bg-card p-4">
									<p className="text-xs text-muted-foreground">Live font preview</p>
									<p className="mt-2 text-2xl font-semibold" style={{ fontFamily: form.fontHeading || 'Georgia' }}>
										{form.name || 'Brand heading'}
									</p>
									<p className="mt-1 text-sm text-muted-foreground" style={{ fontFamily: form.fontBody || 'Inter' }}>
										Body copy for pin descriptions and supporting text.
									</p>
								</div>
							</Section>

							<Section id="assets" open={openSections.assets} onToggle={toggleSection}>
								<div
									className={`bk-dropzone ${dropActive ? 'is-active' : ''}`}
									onDragEnter={(e) => { e.preventDefault(); setDropActive(true); }}
									onDragOver={(e) => { e.preventDefault(); setDropActive(true); }}
									onDragLeave={() => setDropActive(false)}
									onDrop={onDropLogo}
								>
									<Upload size={18} className="mx-auto text-primary" />
									<p className="mt-2 text-sm font-medium">Drop a logo URL here</p>
									<p className="mt-1 text-xs text-muted-foreground">Or paste a hosted image link below</p>
								</div>
								<Input label="Logo URL" value={form.logoUrl} onChange={(e) => updateField('logoUrl', e.target.value)} placeholder="https://…" />
								{form.logoUrl ? (
									<div className="flex h-16 items-center rounded-xl border border-border bg-secondary/40 px-3">
										<img src={form.logoUrl} alt="Logo preview" className="max-h-12 max-w-full object-contain" />
									</div>
								) : null}
								<Input label="Watermark text" value={form.watermarkText} onChange={(e) => updateField('watermarkText', e.target.value)} />
								<Input label="Watermark image URL" value={form.watermarkUrl} onChange={(e) => updateField('watermarkUrl', e.target.value)} placeholder="https://…" />
							</Section>

							<Section id="settings" open={openSections.settings} onToggle={toggleSection}>
								<label className="bk-switch">
									<input type="checkbox" checked={form.isDefault} onChange={(e) => updateField('isDefault', e.target.checked)} />
									Set as default brand kit
								</label>
								<Button type="submit" className="w-full" disabled={saving}>
									{saving ? <Spinner className="h-4 w-4" /> : <Save size={16} />}
									Save Brand Kit
								</Button>
							</Section>
						</form>
					</section>

					<aside className="bk-atelier__preview p-4">
						<div className="mb-3 flex items-center justify-between gap-2">
							<div>
								<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Live preview</p>
								<h3 className="font-display text-lg font-semibold">Brand pin</h3>
							</div>
							<div className="flex flex-wrap justify-end gap-1 rounded-xl border border-border bg-background/70 p-1">
								{[
									{ id: 'fit', label: 'Fit' },
									{ id: '100', label: '100%' },
									{ id: 'mobile', label: 'Mobile' },
									{ id: 'desktop', label: 'Desktop' },
								].map((mode) => (
									<button
										key={mode.id}
										type="button"
										className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${previewMode === mode.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
										onClick={() => setPreviewMode(mode.id)}
									>
										{mode.label}
									</button>
								))}
							</div>
						</div>

						<div className="bk-preview-stage">
							<div
								className={`bk-pin is-${previewMode}`}
								style={{
									background: `linear-gradient(165deg, ${form.secondaryColor || '#F97316'}33, ${form.primaryColor || '#111827'}22)`,
								}}
							>
								<div
									className="bk-pin__media"
									style={{
										background: `linear-gradient(180deg, ${form.primaryColor || '#111827'} 0%, ${form.secondaryColor || '#F97316'} 100%)`,
										color: '#fff',
									}}
								>
									<div className="flex items-start justify-between gap-2">
										{form.logoUrl ? (
											<img src={form.logoUrl} alt="" className="bk-pin__logo" />
										) : (
											<span className="rounded-full bg-white/15 px-2 py-1 text-[10px] font-semibold tracking-wide">
												{form.name || 'Brand'}
											</span>
										)}
										<span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ background: form.accentColor || '#0EA5E9', color: '#111' }}>
											New
										</span>
									</div>

									<div>
										<p className="text-[10px] uppercase tracking-[0.16em] opacity-80">{form.websiteUrl ? form.websiteUrl.replace(/^https?:\/\//, '') : 'chefia.studio'}</p>
										<h4 className="mt-2 text-xl font-semibold leading-tight" style={{ fontFamily: form.fontHeading || 'Georgia' }}>
											Signature flavor, plated beautifully
										</h4>
										<p className="mt-2 text-xs opacity-90" style={{ fontFamily: form.fontBody || 'Inter' }}>
											A sample pin using your brand colors, type, and watermark.
										</p>
										<button
											type="button"
											className="mt-3 rounded-full px-3 py-1.5 text-[11px] font-semibold"
											style={{ background: form.accentColor || '#0EA5E9', color: '#111' }}
										>
											Save Recipe
										</button>
									</div>

									{form.watermarkUrl ? (
										<img src={form.watermarkUrl} alt="" className="bk-pin__watermark-img" />
									) : form.watermarkText ? (
										<span className="bk-pin__watermark">{form.watermarkText}</span>
									) : null}
								</div>
							</div>
						</div>

						<div className="mt-4 grid grid-cols-3 gap-2">
							<div className="rounded-xl border border-border p-2 text-center">
								<span className="mx-auto mb-1 block h-4 w-4 rounded-full border" style={{ background: form.primaryColor }} />
								<p className="text-[10px] text-muted-foreground">Primary</p>
							</div>
							<div className="rounded-xl border border-border p-2 text-center">
								<span className="mx-auto mb-1 block h-4 w-4 rounded-full border" style={{ background: form.secondaryColor }} />
								<p className="text-[10px] text-muted-foreground">Secondary</p>
							</div>
							<div className="rounded-xl border border-border p-2 text-center">
								<span className="mx-auto mb-1 block h-4 w-4 rounded-full border" style={{ background: form.accentColor }} />
								<p className="text-[10px] text-muted-foreground">Accent</p>
							</div>
						</div>
					</aside>
				</div>
			)}
		</div>
	);
}
