import { Link } from 'react-router-dom';
import { Button } from '@/components/kit';

export default function AppErrorPage() {
	return (
		<div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
			<p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">500</p>
			<h1 className="mt-2 text-3xl font-semibold">Something went wrong</h1>
			<p className="mt-3 text-sm text-muted-foreground">
				An unexpected error occurred. Please refresh or return to the dashboard.
			</p>
			<div className="mt-6 flex gap-2">
				<Button variant="outline" onClick={() => window.location.reload()}>Refresh</Button>
				<Link to="/app">
					<Button>Go to dashboard</Button>
				</Link>
			</div>
		</div>
	);
}
