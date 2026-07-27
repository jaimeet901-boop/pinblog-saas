import { Building2, Check, ChevronsUpDown, Coins, Crown } from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspace } from '@/context/WorkspaceContext';

export default function WorkspaceSwitcher() {
	const { workspaces, activeWorkspace, switchWorkspace, loading } = useWorkspace();
	const active = activeWorkspace;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="flex max-w-[220px] items-center gap-2 rounded-xl border border-border/70 bg-card/80 px-2.5 py-1.5 text-left transition-colors hover:bg-secondary sm:max-w-[280px]"
					aria-label="Switch workspace"
				>
					<span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary">
						{active?.logo ? (
							<img src={active.logo} alt="" className="h-full w-full object-cover" />
						) : (
							<Building2 size={16} />
						)}
					</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-sm font-semibold leading-tight">
							{loading ? 'Loading…' : (active?.name || 'Workspace')}
						</span>
						<span className="block truncate text-[11px] text-muted-foreground">
							{(active?.planName || active?.planSlug || 'free')} · {Number(active?.creditsRemaining || 0).toLocaleString()} credits
						</span>
					</span>
					<ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-80 rounded-xl">
				<DropdownMenuLabel className="font-normal">
					<p className="text-xs uppercase tracking-wide text-muted-foreground">Switch workspace</p>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{workspaces.length === 0 ? (
					<div className="px-2 py-3 text-sm text-muted-foreground">No workspaces yet</div>
				) : (
					workspaces.map((ws) => {
						const isActive = ws.id === active?.id;
						return (
							<DropdownMenuItem
								key={ws.id}
								className="cursor-pointer rounded-lg"
								onClick={() => switchWorkspace(ws.id)}
							>
								<span className="flex w-full items-start gap-2">
									<span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary">
										{ws.logo ? (
											<img src={ws.logo} alt="" className="h-full w-full object-cover" />
										) : (
											<Building2 size={14} />
										)}
									</span>
									<span className="min-w-0 flex-1">
										<span className="flex items-center gap-1.5">
											<span className="truncate text-sm font-medium">{ws.name}</span>
											{isActive ? <Check size={14} className="shrink-0 text-primary" /> : null}
										</span>
										<span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
											<span className="inline-flex items-center gap-1"><Crown size={10} />{ws.planName || ws.planSlug || 'free'}</span>
											<span className="inline-flex items-center gap-1"><Coins size={10} />{Number(ws.creditsRemaining || 0).toLocaleString()}</span>
										</span>
										<span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
											Owner: {ws.owner?.name || ws.owner?.email || '—'}
										</span>
									</span>
								</span>
							</DropdownMenuItem>
						);
					})
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
