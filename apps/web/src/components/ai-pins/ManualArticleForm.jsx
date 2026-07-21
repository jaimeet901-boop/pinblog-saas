import { useState } from 'react';
import { X } from 'lucide-react';
import { Button, Card, Input, Spinner, Textarea } from '@/components/kit';

const blank = {
	title: '',
	url: '',
	description: '',
	excerpt: '',
	category: '',
	author: '',
	featuredImage: '',
	language: 'English',
};

export default function ManualArticleForm({ open, onClose, onSubmit, saving = false }) {
	const [form, setForm] = useState(blank);
	const [error, setError] = useState('');

	if (!open) {
		return null;
	}

	const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

	const handleSubmit = async (event) => {
		event.preventDefault();
		setError('');
		if (!form.title.trim()) {
			setError('Title is required.');
			return;
		}
		try {
			await onSubmit?.({
				title: form.title.trim(),
				url: form.url.trim(),
				description: form.description.trim(),
				excerpt: form.excerpt.trim(),
				category: form.category.trim(),
				author: form.author.trim(),
				featuredImage: form.featuredImage.trim(),
				language: form.language.trim() || 'English',
			});
			setForm(blank);
		} catch (err) {
			setError(err?.message || 'Failed to save manual article.');
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
			<Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between">
					<h3 className="font-semibold">Add manual article</h3>
					<button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
				</div>
				<form onSubmit={handleSubmit} className="space-y-3">
					<Input label="Title" required value={form.title} onChange={(e) => update({ title: e.target.value })} placeholder="Article title" />
					<Input label="URL (optional)" type="url" value={form.url} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com/post" />
					<Textarea label="SEO description" rows={3} value={form.description} onChange={(e) => update({ description: e.target.value })} placeholder="Short description for pin generation" />
					<Textarea label="Excerpt / body notes" rows={4} value={form.excerpt} onChange={(e) => update({ excerpt: e.target.value })} placeholder="Paste key points from the article" />
					<div className="grid gap-3 md:grid-cols-2">
						<Input label="Category" value={form.category} onChange={(e) => update({ category: e.target.value })} />
						<Input label="Author" value={form.author} onChange={(e) => update({ author: e.target.value })} />
					</div>
					<Input label="Featured image URL" value={form.featuredImage} onChange={(e) => update({ featuredImage: e.target.value })} placeholder="https://..." />
					<Input label="Language" value={form.language} onChange={(e) => update({ language: e.target.value })} />
					{error ? <p className="text-xs text-destructive">{error}</p> : null}
					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
						<Button type="submit" disabled={saving}>{saving ? <Spinner className="h-4 w-4" /> : null} Save article</Button>
					</div>
				</form>
			</Card>
		</div>
	);
}
