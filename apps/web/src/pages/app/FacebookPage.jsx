import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Facebook, Link2, Loader2 } from 'lucide-react';
import { Button } from '@/components/kit';
import { usePersistWebsiteQuery } from '@/hooks/usePersistWebsiteQuery';
import { consumeSetupReturnPath } from '@/lib/websites/websiteLifecycle';
import { useToast } from '@/hooks/use-toast';

/**
 * Facebook Hub scaffold — mirrors Pinterest connect entry for Active Website return paths.
 * Real OAuth / Graph API wiring is not available yet.
 */
export default function FacebookPage() {
	const { toast } = useToast();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const websiteId = String(searchParams.get('websiteId') || '').trim();
	const setupMode = searchParams.get('setup') === '1';
	usePersistWebsiteQuery(websiteId);

	const returnToStudio = () => {
		const returnTo = consumeSetupReturnPath()
			|| (websiteId
				? `/app/ai-facebook-pages?websiteId=${encodeURIComponent(websiteId)}&setup=publish`
				: '/app/ai-facebook-pages');
		navigate(returnTo);
	};

	const connectFacebook = () => {
		toast({
			variant: 'destructive',
			title: 'Facebook APIs missing',
			description: 'OAuth start, account sync, and Page listing endpoints are not available yet.',
		});
	};

	return (
		<div className="ai-pins-atelier">
			<div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Chef IA Studio</p>
					<h1 className="font-display text-3xl font-semibold tracking-tight">Facebook Hub</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						{setupMode
							? 'Connect Facebook to publish your first post. You will return to AI Facebook Pages after connecting.'
							: 'Connect Facebook accounts and Pages for publishing. OAuth and Graph API arrive in a later phase.'}
					</p>
				</div>
				<Link to={websiteId ? `/app/ai-facebook-pages?websiteId=${encodeURIComponent(websiteId)}` : '/app/ai-facebook-pages'}>
					<Button variant="outline" size="sm"><Facebook size={14} /> AI Facebook Pages</Button>
				</Link>
			</div>

			<div className="mb-4 flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p className="text-sm font-medium">Why connect Facebook?</p>
					<p className="text-xs text-muted-foreground">
						Publishing Facebook Posts requires a connected Facebook account and Facebook Page.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button size="sm" onClick={connectFacebook}>
						<Link2 size={14} /> Connect Facebook
					</Button>
					{setupMode ? (
						<Button size="sm" variant="outline" onClick={returnToStudio}>Back to studio</Button>
					) : null}
				</div>
			</div>

			<div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-8 text-center">
				<Loader2 className="mx-auto mb-3 h-5 w-5 text-muted-foreground" />
				<p className="text-sm font-medium">Facebook connection APIs not wired yet</p>
				<p className="mt-1 text-xs text-muted-foreground">
					Needed next: OAuth start/callback, accounts, Pages, publish, schedule, and jobs.
				</p>
			</div>
		</div>
	);
}
