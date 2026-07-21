import { Eye, FileText } from 'lucide-react';
import { Badge, Button, Empty, Input, Select, Spinner } from '@/components/kit';

export default function ArticlePicker({
	websites = [],
	websiteId = '',
	onWebsiteChange,
	articles = [],
	loading = false,
	search = '',
	onSearchChange,
	status = '',
	onStatusChange,
	category = '',
	onCategoryChange,
	categories = [],
	page = 1,
	totalPages = 1,
	onPageChange,
	selectedIds = new Set(),
	activeId = '',
	onToggleSelect,
	onSelectActive,
	onPreview,
	onOpenManual,
}) {
	return (
		<div className="space-y-4">
			<div className="grid gap-3 md:grid-cols-4">
				<Select label="Website" value={websiteId} onChange={(e) => onWebsiteChange?.(e.target.value)}>
					<option value="">Select website</option>
					{websites.map((website) => (
						<option key={website.id} value={website.id}>{website.name || website.domain || website.id}</option>
					))}
				</Select>
				<Input label="Search" value={search} onChange={(e) => onSearchChange?.(e.target.value)} placeholder="Title, URL, or description" />
				<Select label="Status" value={status} onChange={(e) => onStatusChange?.(e.target.value)}>
					<option value="">All statuses</option>
					<option value="new">New</option>
					<option value="imported">Imported</option>
					<option value="published">Published</option>
				</Select>
				<Select label="Category" value={category} onChange={(e) => onCategoryChange?.(e.target.value)}>
					<option value="">All categories</option>
					{categories.map((item) => (
						<option key={item} value={item}>{item}</option>
					))}
				</Select>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs text-muted-foreground">{selectedIds.size} selected</p>
				<div className="flex gap-2">
					<Button type="button" size="sm" variant="outline" onClick={onOpenManual} disabled={!websiteId}>Add manual article</Button>
				</div>
			</div>

			<div className="max-h-80 overflow-auto rounded-xl border border-border">
				{loading ? (
					<div className="flex items-center justify-center py-10 text-muted-foreground">
						<Spinner className="mr-2 h-4 w-4" /> Loading articles...
					</div>
				) : articles.length === 0 ? (
					<div className="p-6">
						<Empty icon={FileText} title="No articles found" subtitle="Scan a website or add a manual article to start generating pins." />
					</div>
				) : (
					<ul className="divide-y divide-border">
						{articles.map((article) => {
							const checked = selectedIds.has(article.id);
							const active = activeId === article.id;
							return (
								<li key={article.id} className={`flex items-start gap-3 p-3 ${active ? 'bg-secondary/40' : ''}`}>
									<input type="checkbox" checked={checked} onChange={() => onToggleSelect?.(article.id)} className="mt-1" />
									<button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelectActive?.(article.id)}>
										<p className="truncate text-sm font-medium">{article.title || article.slug}</p>
										<p className="truncate text-xs text-muted-foreground">{article.url}</p>
										<div className="mt-1 flex flex-wrap items-center gap-2">
											{article.status ? <Badge tone="blue">{article.status}</Badge> : null}
											{article.category ? <Badge tone="default">{article.category}</Badge> : null}
										</div>
									</button>
									<Button type="button" size="sm" variant="ghost" onClick={() => onPreview?.(article)} aria-label="Preview article">
										<Eye size={14} />
									</Button>
								</li>
							);
						})}
					</ul>
				)}
			</div>

			{totalPages > 1 ? (
				<div className="flex items-center justify-between">
					<p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
					<div className="flex gap-2">
						<Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>Previous</Button>
						<Button type="button" size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange?.(page + 1)}>Next</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
