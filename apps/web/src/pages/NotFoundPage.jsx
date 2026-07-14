import { Link } from 'react-router-dom';
import { Button } from '@/components/kit';

export default function NotFoundPage() {
	return (
		<div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
			<p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">404</p>
			<h1 className="mt-2 text-3xl font-semibold">Page not found</h1>
			<p className="mt-3 text-sm text-muted-foreground">
				The page you are looking for does not exist or has been moved.
			</p>
			<div className="mt-6">
				<Link to="/app">
					<Button>Back to dashboard</Button>
				</Link>
			</div>
		</div>
	);
}
