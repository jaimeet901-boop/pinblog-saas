import { Button, Card } from '@/components/kit';
import { Facebook, History, Newspaper, ScanSearch, Wand2 } from 'lucide-react';

/**
 * Operate Quick Actions — existing modules only.
 */
export default function OperateQuickActions({
	scanning = false,
	onScan,
	onArticles,
	onGeneratePin,
	onGenerateFacebookPost,
	onPublishingHistory,
}) {
	const actions = [
		{ id: 'scan', label: scanning ? 'Scanning...' : 'Scan Website', icon: ScanSearch, onClick: onScan, primary: true, disabled: scanning },
		{ id: 'articles', label: 'Open Articles', icon: Newspaper, onClick: onArticles },
		{ id: 'pins', label: 'Generate AI Pin', icon: Wand2, onClick: onGeneratePin },
		{ id: 'facebook', label: 'Generate Facebook Post', icon: Facebook, onClick: onGenerateFacebookPost },
		{ id: 'history', label: 'Pinterest Publishing', icon: History, onClick: onPublishingHistory },
	];

	return (
		<Card className="mb-4">
			<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Quick actions</p>
			<div className="mt-3 flex flex-wrap gap-2">
				{actions.map((action) => {
					const Icon = action.icon;
					return (
						<Button
							key={action.id}
							size="sm"
							variant={action.primary ? 'default' : 'outline'}
							disabled={action.disabled}
							onClick={action.onClick}
						>
							<Icon size={14} /> {action.label}
						</Button>
					);
				})}
			</div>
		</Card>
	);
}
