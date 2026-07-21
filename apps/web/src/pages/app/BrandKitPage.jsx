import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Palette, Plus, Trash2 } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Card, Empty, Input, PageHeader, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';

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

export default function BrandKitPage() {
	const { toast } = useToast();
	const [items, setItems] = useState([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [form, setForm] = useState(blank);

	const load = async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch('/ai-pins/brand-kits', { method: 'GET' });
			const payload = await response.json().catch(() => []);
			if (!response.ok) {
				throw new Error(payload?.message || 'Failed to load brand kits');
			}
			setItems(Array.isArray(payload) ? payload : []);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
	}, []);

	const save = async (event) => {
		event.preventDefault();
		setSaving(true);
		try {
			const response = await apiServerClient.fetch('/ai-pins/brand-kits', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(form),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || 'Failed to save brand kit');
			}
			toast({ title: 'Brand kit saved' });
			setForm(blank);
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
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		}
	};

	return (
		<div>
			<PageHeader
				title="Brand Kit"
				subtitle="Configure logo, colors, fonts, and watermark for AI Pins."
				action={<Link to="/app/ai-pins"><Button variant="outline">Back to AI Pins</Button></Link>}
			/>

			<div className="grid gap-4 lg:grid-cols-2">
				<Card>
					<form onSubmit={save} className="space-y-3">
						<Input label="Name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} required />
						<Input label="Website URL" value={form.websiteUrl} onChange={(e) => setForm((prev) => ({ ...prev, websiteUrl: e.target.value }))} />
						<Input label="Logo URL" value={form.logoUrl} onChange={(e) => setForm((prev) => ({ ...prev, logoUrl: e.target.value }))} />
						<div className="grid gap-3 md:grid-cols-3">
							<Input label="Primary" value={form.primaryColor} onChange={(e) => setForm((prev) => ({ ...prev, primaryColor: e.target.value }))} />
							<Input label="Secondary" value={form.secondaryColor} onChange={(e) => setForm((prev) => ({ ...prev, secondaryColor: e.target.value }))} />
							<Input label="Accent" value={form.accentColor} onChange={(e) => setForm((prev) => ({ ...prev, accentColor: e.target.value }))} />
						</div>
						<div className="grid gap-3 md:grid-cols-2">
							<Input label="Heading font" value={form.fontHeading} onChange={(e) => setForm((prev) => ({ ...prev, fontHeading: e.target.value }))} />
							<Input label="Body font" value={form.fontBody} onChange={(e) => setForm((prev) => ({ ...prev, fontBody: e.target.value }))} />
						</div>
						<Input label="Watermark text" value={form.watermarkText} onChange={(e) => setForm((prev) => ({ ...prev, watermarkText: e.target.value }))} />
						<Input label="Watermark image URL" value={form.watermarkUrl} onChange={(e) => setForm((prev) => ({ ...prev, watermarkUrl: e.target.value }))} />
						<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((prev) => ({ ...prev, isDefault: e.target.checked }))} /> Set as default</label>
						<Button type="submit" disabled={saving}>{saving ? <Spinner className="h-4 w-4" /> : <Plus size={16} />} Save brand kit</Button>
					</form>
				</Card>

				<Card>
					{loading ? (
						<div className="flex justify-center py-10"><Spinner /></div>
					) : items.length === 0 ? (
						<Empty icon={Palette} title="No brand kits yet" subtitle="Create your first brand kit to apply branding to generated pins." />
					) : (
						<div className="space-y-3">
							{items.map((item) => (
								<div key={item.id} className="rounded-xl border border-border p-3">
									<div className="flex items-start justify-between gap-2">
										<div>
											<p className="font-medium">{item.name}</p>
											<p className="text-xs text-muted-foreground">{item.websiteUrl || 'No website URL'}</p>
											<div className="mt-2 flex gap-2">
												<span className="h-4 w-4 rounded-full border" style={{ background: item.primaryColor }} />
												<span className="h-4 w-4 rounded-full border" style={{ background: item.secondaryColor }} />
												<span className="h-4 w-4 rounded-full border" style={{ background: item.accentColor }} />
												{item.isDefault ? <Badge tone="green">Default</Badge> : null}
											</div>
										</div>
										<Button size="sm" variant="ghost" onClick={() => remove(item.id)}><Trash2 size={14} /></Button>
									</div>
								</div>
							))}
						</div>
					)}
				</Card>
			</div>
		</div>
	);
}
