import { useEffect, useState } from 'react';
import { PenLine, Wand2, Save, Loader2, Globe, Upload, ExternalLink } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import apiServerClient from '@/lib/apiServerClient';
import { generateText, extractJson } from '@/lib/aiGenerate';
import { Card, PageHeader, Button, Input, Select, Textarea, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';

const initForm = {
	keyword: '', secondary: '', country: 'United States', language: 'English',
	length: 'Medium (1000-1500 words)', tone: 'Friendly', headings: '4',
};

function stripHtml(value) {
	if (typeof value !== 'string') {
		return '';
	}

	return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// Compose a WordPress-ready HTML document from the structured article.
function composeHtml(a) {
	const parts = [];
	if (a.introduction) parts.push(a.introduction);
	for (const s of a.sections || []) {
		const level = s.level === 'h3' ? 'h3' : 'h2';
		parts.push(`<${level}>${s.heading || ''}</${level}>`);
		parts.push(s.content || '');
	}
	if (a.faq?.length) {
		parts.push('<h2>Frequently Asked Questions</h2>');
		for (const f of a.faq) {
			parts.push(`<h3>${f.question || ''}</h3>`);
			parts.push(`<p>${f.answer || ''}</p>`);
		}
	}
	if (a.conclusion) {
		parts.push('<h2>Conclusion</h2>');
		parts.push(a.conclusion);
	}
	if (a.recipe_schema) {
		parts.push(
			`<script type="application/ld+json">${JSON.stringify(a.recipe_schema)}</script>`,
		);
	}
	return parts.join('\n');
}

export default function WriterPage() {
	const { toast } = useToast();
	const [form, setForm] = useState(initForm);
	const [generating, setGenerating] = useState(false);
	const [stream, setStream] = useState('');
	const [article, setArticle] = useState(null);
	const [saving, setSaving] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [sites, setSites] = useState([]);
	const [siteId, setSiteId] = useState('');

	useEffect(() => {
		pb.collection('websites')
			.getFullList({ sort: '-created' })
			.then((rows) => {
				setSites(rows);
				const connected = rows.find((r) => r.status === 'connected') || rows[0];
				if (connected) setSiteId(connected.id);
			})
			.catch(() => {});
	}, []);

	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

	const generate = async (e) => {
		e.preventDefault();
		if (!form.keyword.trim()) return;
		setGenerating(true); setArticle(null); setStream('');
		const prompt = `Write a complete SEO-optimized food blog article.
Main keyword: ${form.keyword}
Secondary keywords: ${form.secondary || 'none'}
Country: ${form.country}
Language: ${form.language}
Article length: ${form.length}
Tone: ${form.tone}
Number of H2/H3 headings: ${form.headings}
Respond ONLY with the JSON object described in your instructions.`;
		try {
			const { text } = await generateText(prompt, { onChunk: setStream });
			const json = extractJson(text);
			if (!json) throw new Error('Could not parse the AI response. Try again.');
			setArticle({ ...json, sections: json.sections || [], faq: json.faq || [] });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Generation failed', description: err?.message });
		} finally { setGenerating(false); }
	};

	const save = async (status) => {
		setSaving(true);
		try {
			await pb.collection('articles').create({
				owner: pb.authStore.record.id,
				keyword: form.keyword,
				seo_title: article.seo_title,
				meta_description: article.meta_description,
				slug: article.slug,
				language: form.language,
				country: form.country,
				tone: form.tone,
				body: article,
				status,
				...(status === 'scheduled' && { scheduled_at: new Date(Date.now() + 86400000).toISOString() }),
			});
			toast({ title: 'Saved', description: `Article saved as ${status}.` });
			setArticle(null); setForm(initForm); setStream('');
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message });
		} finally { setSaving(false); }
	};

	const publishToWp = async (wpStatus) => {
		const site = sites.find((s) => s.id === siteId);
		if (!site) {
			toast({ variant: 'destructive', title: 'No website selected', description: 'Add and connect a WordPress site first.' });
			return;
		}
		setPublishing(true);
		try {
			const res = await apiServerClient.fetch('/wordpress/publish', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					siteId: site.id,
					title: article.seo_title || form.keyword,
					content: composeHtml(article),
					slug: article.slug,
					excerpt: article.meta_description,
					status: wpStatus,
				}),
			});
			const data = await res.json();
			if (!res.ok || !data.ok) throw new Error(data.error || 'Publish failed');
			// Also persist a record locally.
			await pb.collection('articles').create({
				owner: pb.authStore.record.id,
				keyword: form.keyword,
				seo_title: article.seo_title,
				meta_description: article.meta_description,
				slug: article.slug,
				language: form.language,
				country: form.country,
				tone: form.tone,
				body: article,
				status: wpStatus === 'publish' ? 'published' : 'draft',
			}).catch(() => {});
			toast({
				title: wpStatus === 'publish' ? 'Published to WordPress' : 'Draft sent to WordPress',
				description: data.link ? data.link : `Post #${data.id} created.`,
			});
		} catch (err) {
			toast({ variant: 'destructive', title: 'WordPress error', description: err?.message });
		} finally { setPublishing(false); }
	};

	const upd = (k, v) => setArticle((a) => ({ ...a, [k]: v }));

	return (
		<div>
			<PageHeader title="AI Writer" subtitle="Generate publish-ready SEO recipe articles and push them straight to WordPress." />
			<div className="grid gap-4 lg:grid-cols-5">
				<Card className="lg:col-span-2 h-fit">
					<form onSubmit={generate} className="space-y-3">
						<Input label="Main keyword" required value={form.keyword} onChange={set('keyword')} placeholder="easy vegan lasagna" />
						<Input label="Secondary keywords" value={form.secondary} onChange={set('secondary')} placeholder="plant-based, dairy-free" />
						<div className="grid grid-cols-2 gap-3">
							<Input label="Country" value={form.country} onChange={set('country')} />
							<Select label="Language" value={form.language} onChange={set('language')}>
								{['English', 'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Dutch', 'Arabic'].map((l) => <option key={l}>{l}</option>)}
							</Select>
						</div>
						<Select label="Article length" value={form.length} onChange={set('length')}>
							<option>Short (600-900 words)</option>
							<option>Medium (1000-1500 words)</option>
							<option>Long (1800-2500 words)</option>
						</Select>
						<div className="grid grid-cols-2 gap-3">
							<Select label="Tone" value={form.tone} onChange={set('tone')}>
								{['Friendly', 'Professional', 'Casual', 'Enthusiastic', 'Authoritative'].map((t) => <option key={t}>{t}</option>)}
							</Select>
							<Select label="Headings" value={form.headings} onChange={set('headings')}>
								{['3', '4', '5', '6', '7'].map((n) => <option key={n}>{n}</option>)}
							</Select>
						</div>
						<Button type="submit" disabled={generating} className="w-full">
							{generating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Wand2 size={16} /> Generate article</>}
						</Button>
					</form>
				</Card>

				<div className="lg:col-span-3">
					{!article && !generating && (
						<Card className="flex flex-col items-center justify-center py-20 text-center">
							<PenLine className="mb-3 h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
							<p className="font-medium">Your generated article will appear here</p>
							<p className="mt-1 text-sm text-muted-foreground">Fill the form and hit generate.</p>
						</Card>
					)}
					{generating && (
						<Card>
							<div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4 text-primary" /> Writing your article…</div>
							<pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{stream}</pre>
						</Card>
					)}
					{article && (
						<Card className="space-y-4">
							<Input label="SEO title" value={article.seo_title || ''} onChange={(e) => upd('seo_title', e.target.value)} />
							<Textarea label="Meta description" rows={2} value={article.meta_description || ''} onChange={(e) => upd('meta_description', e.target.value)} />
							<Input label="Slug" value={article.slug || ''} onChange={(e) => upd('slug', e.target.value)} />
							<Textarea label="Introduction" rows={3} value={article.introduction || ''} onChange={(e) => upd('introduction', e.target.value)} />
							<div>
								<p className="mb-1.5 text-sm font-medium">Sections</p>
								<div className="max-h-72 space-y-2 overflow-auto rounded-xl border border-border p-3">
									{article.sections?.map((s, i) => (
										<div key={i} className="rounded-lg bg-secondary/60 p-2.5">
											<p className="text-sm font-semibold uppercase text-primary">{s.level || 'h2'} · {s.heading}</p>
											<p className="mt-1 text-xs text-muted-foreground">{stripHtml(s.content)}</p>
										</div>
									))}
								</div>
							</div>
							{article.faq?.length > 0 && (
								<div>
									<p className="mb-1.5 text-sm font-medium">FAQ ({article.faq.length})</p>
									<div className="max-h-48 space-y-2 overflow-auto rounded-xl border border-border p-3 text-sm">
										{article.faq.map((f, i) => (
											<div key={i}><p className="font-medium">{f.question}</p><p className="text-xs text-muted-foreground">{f.answer}</p></div>
										))}
									</div>
								</div>
							)}
							<Textarea label="Conclusion" rows={3} value={article.conclusion || ''} onChange={(e) => upd('conclusion', e.target.value)} />
							{article.recipe_schema && (
								<div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
									✓ JSON-LD Recipe Schema included
								</div>
							)}

							<div className="flex flex-wrap gap-2">
								<Button onClick={() => save('draft')} disabled={saving} variant="outline"><Save size={15} /> Save draft</Button>
								<Button onClick={() => save('scheduled')} disabled={saving} variant="accent">Schedule</Button>
								<Button onClick={() => save('published')} disabled={saving}>Save as published</Button>
							</div>

							<div className="rounded-xl border border-border bg-secondary/40 p-4">
								<div className="mb-3 flex items-center gap-2 text-sm font-medium">
									<Globe size={16} className="text-primary" /> Publish to WordPress
								</div>
								{sites.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										No WordPress websites yet. Add and connect one on the Websites page first.
									</p>
								) : (
									<>
										<Select label="Target website" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
											{sites.map((s) => (
												<option key={s.id} value={s.id}>
													{s.name} {s.status === 'connected' ? '(connected)' : `(${s.status})`}
												</option>
											))}
										</Select>
										<div className="mt-3 flex flex-wrap gap-2">
											<Button onClick={() => publishToWp('draft')} disabled={publishing} variant="outline">
												{publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload size={15} />} Push as WP draft
											</Button>
											<Button onClick={() => publishToWp('publish')} disabled={publishing}>
												{publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink size={15} />} Publish live
											</Button>
										</div>
									</>
								)}
							</div>
						</Card>
					)}
				</div>
			</div>
		</div>
	);
}
