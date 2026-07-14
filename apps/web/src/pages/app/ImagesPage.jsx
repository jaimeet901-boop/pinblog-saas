import { useEffect, useState } from 'react';
import { Image as ImageIcon, Wand2, Loader2, Download, Save } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import { generateText } from '@/lib/aiGenerate';
import { Card, PageHeader, Button, Input, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';

const FORMATS = [
	{ id: 'square', label: 'Square', ratio: '1:1', box: 'aspect-square' },
	{ id: 'portrait', label: 'Portrait (Pin)', ratio: '2:3', box: 'aspect-[2/3]' },
	{ id: 'landscape', label: 'Landscape', ratio: '16:9', box: 'aspect-video' },
];

export default function ImagesPage() {
	const { toast } = useToast();
	const [prompt, setPrompt] = useState('');
	const [format, setFormat] = useState('portrait');
	const [loading, setLoading] = useState(false);
	const [result, setResult] = useState(null);
	const [pins, setPins] = useState([]);

	const load = async () => {
		try { setPins(await pb.collection('pins').getFullList({ sort: '-created', requestKey: 'pins' })); } catch (_) { /* */ }
	};
	useEffect(() => { load(); }, []);

	const fmt = FORMATS.find((f) => f.id === format);

	const generate = async (e) => {
		e.preventDefault();
		if (!prompt.trim()) return;
		setLoading(true); setResult(null);
		try {
			const p = `Generate a vibrant, appetizing Pinterest food image. Aspect ratio ${fmt.ratio}. Subject: ${prompt}. Bright, high-quality food photography, styled for Pinterest.`;
			const { images } = await generateText(p);
			if (!images.length) throw new Error('No image was generated. Try again.');
			setResult(images[0]);
		} catch (err) {
			toast({ variant: 'destructive', title: 'Generation failed', description: err?.message });
		} finally { setLoading(false); }
	};

	const savePin = async () => {
		try {
			await pb.collection('pins').create({
				owner: pb.authStore.record.id,
				title: prompt.slice(0, 120),
				image_url: result,
				format,
				status: 'draft',
			});
			toast({ title: 'Saved to pins' });
			load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message });
		}
	};

	return (
		<div>
			<PageHeader title="AI Image Generator" subtitle="Create scroll-stopping Pinterest images automatically." />
			<div className="grid gap-4 lg:grid-cols-5">
				<Card className="lg:col-span-2 h-fit space-y-4">
					<form onSubmit={generate} className="space-y-4">
						<Input label="Describe your image" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Creamy garlic pasta on a rustic table" />
						<div>
							<p className="mb-1.5 text-sm font-medium">Format</p>
							<div className="grid grid-cols-3 gap-2">
								{FORMATS.map((f) => (
									<button type="button" key={f.id} onClick={() => setFormat(f.id)}
										className={`rounded-xl border p-2 text-xs font-medium ${format === f.id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary'}`}>
										{f.label}
										<span className="mt-0.5 block text-[10px] text-muted-foreground">{f.ratio}</span>
									</button>
								))}
							</div>
						</div>
						<Button type="submit" disabled={loading} className="w-full">
							{loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Wand2 size={16} /> Generate image</>}
						</Button>
					</form>
				</Card>

				<Card className="lg:col-span-3">
					<div className={`mx-auto flex ${fmt.box} max-h-[60vh] items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-secondary/40`}>
						{loading ? (
							<div className="flex flex-col items-center gap-2 text-sm text-muted-foreground"><Spinner className="text-primary" /> Cooking up your image…</div>
						) : result ? (
							<img src={result} alt="Generated" loading="lazy" decoding="async" className="h-full w-full object-cover" />
						) : (
							<div className="flex flex-col items-center gap-2 text-muted-foreground"><ImageIcon size={40} strokeWidth={1.5} /><span className="text-sm">Preview</span></div>
						)}
					</div>
					{result && (
						<div className="mt-4 flex gap-2">
							<a href={result} download target="_blank" rel="noreferrer"><Button variant="outline"><Download size={15} /> Download</Button></a>
							<Button onClick={savePin}><Save size={15} /> Save pin</Button>
						</div>
					)}
				</Card>
			</div>

			{pins.length > 0 && (
				<div className="mt-8">
					<h3 className="mb-3 font-semibold">Recent pins</h3>
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
						{pins.map((p) => (
							<div key={p.id} className="overflow-hidden rounded-xl border border-border">
								<img src={p.image_url} alt={p.title} loading="lazy" decoding="async" className="aspect-square w-full object-cover" />
								<p className="truncate p-2 text-xs text-muted-foreground">{p.title}</p>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
