import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';

export default function AuthShell({ title, subtitle, children, footer }) {
	return (
		<div className="grid min-h-[100dvh] lg:grid-cols-2">
			<div className="relative hidden overflow-hidden bg-primary lg:block">
				<div className="absolute inset-0 bg-gradient-to-br from-primary to-accent opacity-90" />
				<div className="relative flex h-full flex-col justify-between p-12 text-primary-foreground">
					<Link to="/" className="flex items-center gap-2">
						<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20"><Sparkles size={18} /></span>
						<span className="font-display text-xl font-600">Chef IA</span>
					</Link>
					<div>
						<h2 className="font-display text-4xl font-600 leading-tight">Turn keywords into published recipes.</h2>
						<p className="mt-4 max-w-sm text-white/80">SEO articles, Pinterest pins, WordPress publishing — all powered by AI, all in one place.</p>
					</div>
					<p className="text-sm text-white/60">Trusted by food bloggers & SEO marketers.</p>
				</div>
			</div>
			<div className="flex items-center justify-center px-5 py-12 sm:px-8 lg:px-12">
				<div className="w-full max-w-md">
					<Link to="/" className="mb-8 flex items-center gap-2 lg:hidden">
						<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Sparkles size={18} /></span>
						<span className="font-display text-xl font-600">Chef IA</span>
					</Link>
					<h1 className="font-display text-2xl font-600 tracking-tight">{title}</h1>
					{subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
					<div className="mt-8">{children}</div>
					{footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
				</div>
			</div>
		</div>
	);
}
