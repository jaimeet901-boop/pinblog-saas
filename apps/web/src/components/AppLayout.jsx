import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
	LayoutDashboard, Globe, PenLine, Image, CalendarDays, BarChart3,
	CreditCard, Settings, Shield, User, LogOut, Menu, X, Moon, Sun, Sparkles, Pin, ChevronDown, Bell, Wand2, History,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import {
	DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
	DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const NAV = [
	{ to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
	{ to: '/app/websites', label: 'Websites', icon: Globe },
	{ to: '/app/ai-pins', label: 'AI Pins', icon: Wand2 },
	{ to: '/app/ai-pins/templates', label: 'Templates', icon: Sparkles },
	{ to: '/app/ai-pins/brand-kit', label: 'Brand Kit', icon: Sparkles },
	{ to: '/app/ai-pins/history', label: 'Pin History', icon: History },
	{ to: '/app/writer', label: 'AI Writer', icon: PenLine },
	{ to: '/app/images', label: 'Image Generator', icon: Image },
	{ to: '/app/pinterest', label: 'Pinterest', icon: Pin },
	{ to: '/app/calendar', label: 'Calendar', icon: CalendarDays },
	{ to: '/app/pinterest-history', label: 'Publishing History', icon: History },
	{ to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
	{ to: '/app/subscription', label: 'Subscription', icon: CreditCard },
	{ to: '/app/settings', label: 'Settings', icon: Settings },
];

export default function AppLayout({ children }) {
	const [open, setOpen] = useState(false);
	const { user, logout } = useAuth();
	const { theme, toggle } = useTheme();
	const navigate = useNavigate();
	const location = useLocation();

	const handleLogout = () => {
		logout();
		navigate('/login');
	};

	const currentLabel =
		user?.role === 'admin' && location.pathname === '/app/admin'
			? 'Admin'
			: NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))?.label || 'Dashboard';

	const NavItems = () => (
		<nav className="flex flex-col gap-1">
			{NAV.map(({ to, label, icon: Icon, end }, i) => (
				<NavLink
					key={to}
					to={to}
					end={end}
					onClick={() => setOpen(false)}
					className={({ isActive }) =>
						`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
							isActive
								? 'bg-primary text-primary-foreground shadow-md shadow-primary/25'
								: 'text-muted-foreground hover:bg-secondary hover:text-foreground hover:translate-x-0.5'
						}`
					}
					style={{ animationDelay: `${i * 30}ms` }}
				>
					{({ isActive }) => (
						<>
							<Icon className="h-4.5 w-4.5 transition-transform group-hover:scale-110" strokeWidth={2} size={18} />
							<span>{label}</span>
							{isActive && (
								<motion.span
									layoutId="nav-active-dot"
									className="ml-auto h-1.5 w-1.5 rounded-full bg-primary-foreground"
								/>
							)}
						</>
					)}
				</NavLink>
			))}
			{user?.role === 'admin' && (
				<NavLink
					to="/app/admin"
					onClick={() => setOpen(false)}
					className={({ isActive }) =>
						`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
							isActive ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25' : 'text-muted-foreground hover:bg-secondary hover:text-foreground hover:translate-x-0.5'
						}`
					}
				>
					<Shield size={18} className="transition-transform group-hover:scale-110" /> Admin
				</NavLink>
			)}
		</nav>
	);

	return (
		<div className="min-h-[100dvh] bg-gradient-to-b from-background to-secondary/30 text-foreground">
			{/* Sidebar desktop */}
			<aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border/80 bg-card/70 backdrop-blur-xl px-4 py-5 lg:flex">
				<Brand />
				<div className="mt-6 flex-1 overflow-y-auto"><NavItems /></div>
				<UserCard user={user} onLogout={handleLogout} />
			</aside>

			{/* Mobile drawer */}
			<AnimatePresence>
				{open && (
					<motion.div
						className="fixed inset-0 z-40 lg:hidden"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.2 }}
					>
						<motion.div
							className="absolute inset-0 bg-black/50"
							onClick={() => setOpen(false)}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
						/>
						<motion.aside
							className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-border bg-card px-4 py-5 shadow-2xl"
							initial={{ x: '-100%' }}
							animate={{ x: 0 }}
							exit={{ x: '-100%' }}
							transition={{ type: 'spring', stiffness: 320, damping: 32 }}
						>
							<div className="flex items-center justify-between">
								<Brand />
								<button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
									<X size={20} />
								</button>
							</div>
							<div className="mt-6 flex-1 overflow-y-auto"><NavItems /></div>
							<UserCard user={user} onLogout={handleLogout} />
						</motion.aside>
					</motion.div>
				)}
			</AnimatePresence>

			<div className="lg:pl-64">
				<header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/70 bg-background/70 px-4 py-3 backdrop-blur-xl lg:px-8">
					<div className="flex items-center gap-3">
						<button
							className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground lg:hidden"
							onClick={() => setOpen(true)}
							aria-label="Open menu"
						>
							<Menu size={22} />
						</button>
						<div>
							<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Workspace</p>
							<h2 className="font-display text-base font-600 leading-tight sm:text-lg">{currentLabel}</h2>
						</div>
					</div>

					<div className="flex items-center gap-2 sm:gap-3">
						<button
							className="hidden rounded-full border border-border/70 p-2 text-muted-foreground transition-colors hover:text-foreground sm:flex"
							aria-label="Notifications"
						>
							<Bell size={17} />
						</button>
						<button
							onClick={toggle}
							className="rounded-full border border-border/70 p-2 text-muted-foreground transition-all duration-200 hover:text-foreground hover:rotate-12"
							aria-label="Toggle theme"
						>
							{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
						</button>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button className="flex items-center gap-2 rounded-full border border-border/70 py-1 pl-1 pr-2.5 transition-colors hover:bg-secondary sm:pr-3">
									<span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
										{(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
									</span>
									<span className="hidden max-w-[120px] truncate text-sm sm:block">{user?.name || user?.email}</span>
									<ChevronDown size={14} className="hidden text-muted-foreground sm:block" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-56 rounded-xl">
								<DropdownMenuLabel className="font-normal">
									<p className="truncate text-sm font-medium">{user?.name || 'Chef'}</p>
									<p className="truncate text-xs text-muted-foreground">{user?.email}</p>
								</DropdownMenuLabel>
								<DropdownMenuSeparator />
								<DropdownMenuItem asChild className="cursor-pointer rounded-lg">
									<Link to="/app/profile"><User size={15} /> Profile</Link>
								</DropdownMenuItem>
								<DropdownMenuItem asChild className="cursor-pointer rounded-lg">
									<Link to="/app/settings"><Settings size={15} /> Settings</Link>
								</DropdownMenuItem>
								<DropdownMenuItem asChild className="cursor-pointer rounded-lg">
									<Link to="/app/subscription"><CreditCard size={15} /> Subscription</Link>
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={handleLogout} className="cursor-pointer rounded-lg text-destructive focus:text-destructive">
									<LogOut size={15} /> Log out
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</header>
				<motion.main
					key={location.pathname}
					initial={{ opacity: 0, y: 8 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.25, ease: 'easeOut' }}
					className="px-4 py-6 lg:px-8 lg:py-8"
				>
					{children}
				</motion.main>
			</div>
		</div>
	);
}

function Brand() {
	return (
		<Link to="/app" className="flex items-center gap-2">
			<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/25">
				<Sparkles size={18} />
			</span>
			<span className="font-display text-xl font-600 tracking-tight">Chef IA</span>
		</Link>
	);
}

function UserCard({ user, onLogout }) {
	return (
		<div className="mt-4 rounded-xl border border-border/80 bg-secondary/40 p-3">
			<div className="flex items-center gap-2">
				<span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
					{(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
				</span>
				<div className="min-w-0">
					<p className="truncate text-sm font-medium">{user?.name || 'Chef'}</p>
					<p className="truncate text-xs capitalize text-muted-foreground">{user?.plan || 'free'} plan</p>
				</div>
			</div>
			<div className="mt-3 flex gap-2">
				<Link to="/app/profile" className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-secondary py-1.5 text-xs font-medium transition-colors hover:bg-secondary/70">
					<User size={13} /> Profile
				</Link>
				<button onClick={onLogout} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-secondary py-1.5 text-xs font-medium transition-colors hover:bg-secondary/70">
					<LogOut size={13} /> Logout
				</button>
			</div>
		</div>
	);
}
