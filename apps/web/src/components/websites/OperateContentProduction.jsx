import { Card } from '@/components/kit';
import { Image as ImageIcon, LayoutTemplate, PenLine, Wand2 } from 'lucide-react';

/**
 * Content Production deep links — existing modules only (Phase 2B).
 */
export default function OperateContentProduction({
	onWriter,
	onAiPins,
	onImages,
	onTemplates,
	showTemplates = false,
}) {
	const links = [
		{ id: 'writer', label: 'Generate Article', hint: 'AI Writer', icon: PenLine, onClick: onWriter },
		{ id: 'pins', label: 'Generate AI Pin', hint: 'AI Pins atelier', icon: Wand2, onClick: onAiPins },
		{ id: 'images', label: 'Image Generator', hint: 'Create imagery', icon: ImageIcon, onClick: onImages },
	];
	if (showTemplates) {
		links.push({ id: 'templates', label: 'Open Templates', hint: 'Pin templates', icon: LayoutTemplate, onClick: onTemplates });
	}

	return (
		<Card className="h-full">
			<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Content production</p>
			<p className="mt-1 text-sm text-muted-foreground">Create content for this website using existing modules.</p>
			<div className="mt-3 grid gap-2">
				{links.map((link) => {
					const Icon = link.icon;
					return (
						<button
							key={link.id}
							type="button"
							onClick={link.onClick}
							className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 px-3 py-2.5 text-left transition hover:bg-secondary/60"
						>
							<span className="inline-flex items-center gap-2 text-sm font-medium">
								<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
									<Icon size={14} />
								</span>
								{link.label}
							</span>
							<span className="text-[11px] text-muted-foreground">{link.hint}</span>
						</button>
					);
				})}
			</div>
			{!showTemplates ? (
				<p className="mt-3 text-[11px] text-muted-foreground">Templates stay in Admin Console when not available here.</p>
			) : null}
		</Card>
	);
}
