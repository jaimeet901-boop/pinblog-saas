import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, FileText } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function formatDate(value) {
	if (!value) {
		return '—';
	}

	try {
		return new Date(value).toLocaleDateString();
	} catch {
		return '—';
	}
}

async function readJson(response) {
	return response.json().catch(() => ({}));
}

export default function WebsiteArticlesPage() {
	const { websiteId } = useParams();
	const navigate = useNavigate();
	const { toast } = useToast();
	const [website, setWebsite] = useState(null);
	const [articlesData, setArticlesData] = useState({ items: [], page: 1, perPage: 10, totalPages: 1, totalItems: 0, categories: [], totalArticles: 0 });
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState({ search: '', status: '', category: '', dateFrom: '', dateTo: '', page: 1 });

	useEffect(() => {
		(async () => {
			try {
				const response = await apiServerClient.fetch(`/websites/${websiteId}`, { method: 'GET' });
				const data = await readJson(response);
				if (!response.ok) {
					throw new Error(data?.message || `Failed to load website (${response.status})`);
				}
				setWebsite(data);
			} catch (error) {
				toast({ variant: 'destructive', title: 'Error', description: error.message });
			} finally {
				setLoading(false);
			}
		})();
	}, [websiteId]);

	useEffect(() => {
		(async () => {
			setLoading(true);
			try {
				const searchParams = new URLSearchParams();
				searchParams.set('page', String(filters.page));
				searchParams.set('perPage', '10');
				if (filters.search) searchParams.set('search', filters.search);
				if (filters.status) searchParams.set('status', filters.status);
				if (filters.category) searchParams.set('category', filters.category);
				if (filters.dateFrom) searchParams.set('dateFrom', filters.dateFrom);
				if (filters.dateTo) searchParams.set('dateTo', filters.dateTo);

				const response = await apiServerClient.fetch(`/websites/${websiteId}/articles?${searchParams.toString()}`, { method: 'GET' });
				const data = await readJson(response);
				if (!response.ok) {
					throw new Error(data?.message || `Failed to load articles (${response.status})`);
				}

				setArticlesData(data);
			} catch (error) {
				toast({ variant: 'destructive', title: 'Error', description: error.message });
			} finally {
				setLoading(false);
			}
		})();
	}, [websiteId, filters.page, filters.search, filters.status, filters.category, filters.dateFrom, filters.dateTo]);

	const updateFilter = (patch) => {
		setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
	};

	return (
		<div>
			<PageHeader
				title={website ? `${website.name} Articles` : 'Website Articles'}
				subtitle="Browse discovered articles with search, filters, and pagination."
				action={(
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={() => navigate(`/app/websites/${websiteId}`)}><ArrowLeft size={16} /> Dashboard</Button>
						<Button variant="outline" onClick={() => navigate('/app/websites')}>All Websites</Button>
					</div>
				)}
			/>

			<div className="mb-4 grid gap-4 lg:grid-cols-5">
				<Card className="lg:col-span-5">
					<div className="grid gap-3 md:grid-cols-5">
						<Input label="Search" value={filters.search} onChange={(e) => updateFilter({ search: e.target.value })} placeholder="Search title, slug, or URL" />
						<Select label="Status" value={filters.status} onChange={(e) => updateFilter({ status: e.target.value })}>
							<option value="">All statuses</option>
							<option value="new">New</option>
							<option value="imported">Imported</option>
							<option value="published">Published</option>
						</Select>
						<Select label="Category" value={filters.category} onChange={(e) => updateFilter({ category: e.target.value })}>
							<option value="">All categories</option>
							{articlesData.categories.map((category) => <option key={category} value={category}>{category}</option>)}
						</Select>
						<Input label="From Date" type="date" value={filters.dateFrom} onChange={(e) => updateFilter({ dateFrom: e.target.value })} />
						<Input label="To Date" type="date" value={filters.dateTo} onChange={(e) => updateFilter({ dateTo: e.target.value })} />
					</div>
				</Card>
			</div>

			<Card>
				<div className="mb-4 flex items-center justify-between gap-2">
					<div>
						<h2 className="font-semibold">Articles</h2>
						<p className="text-sm text-muted-foreground">Total Articles: {articlesData.totalArticles || 0}</p>
					</div>
					{loading && <Spinner className="h-4 w-4 text-primary" />}
				</div>

				{!loading && articlesData.items.length === 0 ? (
					<Empty icon={FileText} title="No articles found" subtitle="Run a website scan or adjust your filters to see discovered content." />
				) : (
					<>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Title</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Category</TableHead>
									<TableHead>Author</TableHead>
									<TableHead>Published</TableHead>
									<TableHead>Updated</TableHead>
									<TableHead className="text-right">Open</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{articlesData.items.map((article) => (
									<TableRow key={article.id}>
										<TableCell>
											<div className="max-w-[320px]">
												<p className="truncate font-medium">{article.title || article.slug}</p>
												<p className="truncate text-xs text-muted-foreground">{article.url}</p>
											</div>
										</TableCell>
										<TableCell><Badge tone={article.status === 'new' ? 'amber' : article.status === 'published' ? 'green' : 'blue'}>{article.status}</Badge></TableCell>
										<TableCell>{article.category || '—'}</TableCell>
										<TableCell>{article.author || '—'}</TableCell>
										<TableCell>{formatDate(article.publishDate)}</TableCell>
										<TableCell>{formatDate(article.lastModifiedDate)}</TableCell>
										<TableCell className="text-right">
											<a href={article.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
												<ExternalLink size={14} /> Open
											</a>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>

						<div className="mt-4 flex items-center justify-between">
							<p className="text-sm text-muted-foreground">Page {articlesData.page} of {articlesData.totalPages}</p>
							<div className="flex gap-2">
								<Button variant="outline" size="sm" disabled={articlesData.page <= 1} onClick={() => updateFilter({ page: articlesData.page - 1 })}>Previous</Button>
								<Button variant="outline" size="sm" disabled={articlesData.page >= articlesData.totalPages} onClick={() => updateFilter({ page: articlesData.page + 1 })}>Next</Button>
							</div>
						</div>
					</>
				)}
			</Card>
		</div>
	);
}