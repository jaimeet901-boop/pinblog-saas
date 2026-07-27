import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2, Sparkles, X } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Button } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';

/**
 * First-login onboarding overlay rendered on the Dashboard (not a separate page).
 */
export default function WorkspaceOnboardingWizard() {
	const { toast } = useToast();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [data, setData] = useState(null);

	const load = async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch('/workspace/v1/onboarding', { method: 'GET' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(payload.message || 'Failed to load onboarding');
			setData(payload);
			setOpen(!payload.finished && !payload.skipped);
		} catch {
			setOpen(false);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
		const onChange = () => load();
		window.addEventListener('chefia:workspace-changed', onChange);
		return () => window.removeEventListener('chefia:workspace-changed', onChange);
	}, []);

	const patch = async (body) => {
		setBusy(true);
		try {
			const response = await apiServerClient.fetch('/workspace/v1/onboarding', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(payload.message || 'Update failed');
			setData(payload);
			if (payload.finished || payload.skipped) setOpen(false);
			return payload;
		} catch (error) {
			toast({ variant: 'destructive', title: 'Onboarding', description: error?.message || 'Update failed' });
			return null;
		} finally {
			setBusy(false);
		}
	};

	if (loading || !open || !data) return null;

	const percent = Number(data.completedPercent) || 0;
	const steps = data.steps || [];

	return (
		<div className="mb-6 overflow-hidden rounded-2xl border border-border/80 bg-card/90 shadow-sm">
			<div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
				<div>
					<p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						<Sparkles size={12} /> Workspace setup
					</p>
					<h3 className="font-display text-lg font-semibold">Get Chef IA ready for your team</h3>
					<p className="text-sm text-muted-foreground">{percent}% complete — you can skip any step.</p>
				</div>
				<button
					type="button"
					className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
					aria-label="Dismiss onboarding"
					onClick={() => patch({ skipAll: true })}
				>
					<X size={16} />
				</button>
			</div>

			<div className="px-4 py-3 sm:px-5">
				<div className="mb-4 h-2 overflow-hidden rounded-full bg-secondary">
					<div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, percent)}%` }} />
				</div>
				<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
					{steps.map((step, index) => (
						<div
							key={step.id}
							className={`rounded-xl border px-3 py-2.5 ${step.done ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/70'}`}
						>
							<div className="flex items-start justify-between gap-2">
								<div>
									<p className="text-xs text-muted-foreground">Step {index + 1}</p>
									<p className="text-sm font-medium">{step.label}</p>
								</div>
								{step.done || step.skipped ? <CheckCircle2 size={16} className="text-emerald-600" /> : null}
							</div>
							<div className="mt-2 flex flex-wrap gap-1.5">
								{!step.done && !step.skipped ? (
									<>
										<Link to={step.to}>
											<Button size="sm" variant="outline" onClick={() => patch({ stepId: step.id, done: true })}>
												Open
											</Button>
										</Link>
										<Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ stepId: step.id, skip: true, done: false })}>
											Skip
										</Button>
									</>
								) : null}
							</div>
						</div>
					))}
				</div>
				<div className="mt-4 flex flex-wrap gap-2">
					<Button disabled={busy} onClick={() => patch({ skipAll: true })}>
						{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
						Finish / Skip setup
					</Button>
					{data.nextStep ? (
						<Link to={data.nextStep.to}>
							<Button variant="outline">Continue: {data.nextStep.label}</Button>
						</Link>
					) : null}
				</div>
			</div>
		</div>
	);
}
