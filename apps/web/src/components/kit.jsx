import { Navigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';

export function ProtectedRoute({ children, admin }) {
	const { isAuthed, user } = useAuth();
	if (!isAuthed) return <Navigate to="/login" replace />;
	if (admin && user?.role !== 'admin') return <Navigate to="/app" replace />;
	return children;
}

export function PageHeader({ title, subtitle, action }) {
	return (
		<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h1 className="font-display text-2xl font-600 tracking-tight sm:text-3xl">{title}</h1>
				{subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
			</div>
			{action}
		</div>
	);
}

export function Card({ className, children }) {
	return (
		<div className={cn('rounded-2xl border border-border/80 bg-card p-5 shadow-sm shadow-black/[0.03] transition-shadow', className)}>
			{children}
		</div>
	);
}

export function Button({ variant = 'primary', className, size = 'md', ...props }) {
	const variants = {
		primary: 'bg-primary text-primary-foreground hover:opacity-90',
		outline: 'border border-border bg-transparent hover:bg-secondary',
		ghost: 'hover:bg-secondary',
		danger: 'bg-destructive text-destructive-foreground hover:opacity-90',
		accent: 'bg-accent text-accent-foreground hover:opacity-90',
	};
	const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm', lg: 'px-6 py-3 text-base' };
	return (
		<button
			className={cn(
				'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
				variants[variant], sizes[size], className,
			)}
			{...props}
		/>
	);
}

export function Input({ className, label, ...props }) {
	return (
		<label className="block">
			{label && <span className="mb-1.5 block text-sm font-medium">{label}</span>}
			<input
				className={cn(
					'w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20',
					className,
				)}
				{...props}
			/>
		</label>
	);
}

export function Select({ className, label, children, ...props }) {
	return (
		<label className="block">
			{label && <span className="mb-1.5 block text-sm font-medium">{label}</span>}
			<select
				className={cn(
					'w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20',
					className,
				)}
				{...props}
			>
				{children}
			</select>
		</label>
	);
}

export function Textarea({ className, label, ...props }) {
	return (
		<label className="block">
			{label && <span className="mb-1.5 block text-sm font-medium">{label}</span>}
			<textarea
				className={cn(
					'w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20',
					className,
				)}
				{...props}
			/>
		</label>
	);
}

export function Badge({ children, tone = 'default' }) {
	const tones = {
		default: 'bg-secondary text-secondary-foreground',
		green: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
		amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
		red: 'bg-red-500/15 text-red-600 dark:text-red-400',
		blue: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
	};
	return (
		<span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', tones[tone])}>
			{children}
		</span>
	);
}

export function Empty({ icon: Icon, title, subtitle, action }) {
	return (
		<div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
			{Icon && <Icon className="mb-3 h-10 w-10 text-muted-foreground" strokeWidth={1.5} />}
			<p className="font-medium">{title}</p>
			{subtitle && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{subtitle}</p>}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}

export function Spinner({ className }) {
	return (
		<div className={cn('h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />
	);
}
