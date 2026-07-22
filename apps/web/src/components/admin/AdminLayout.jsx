import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
	LayoutDashboard, Users, Building2, CreditCard, Coins, Cpu, Boxes, Globe, Pin,
	BarChart3, ListOrdered, Briefcase, ScrollText, Bell, Settings, Activity,
	Menu, X, LogOut, ArrowLeftRight, Shield, ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ADMIN_NAV } from '@/lib/adminRbac';
import './AdminLayout.css';

const ICONS = {
	'/admin/dashboard': LayoutDashboard,
	'/admin/users': Users,
	'/admin/workspaces': Building2,
	'/admin/plans': CreditCard,
	'/admin/credits': Coins,
	'/admin/providers': Cpu,
	'/admin/models': Boxes,
	'/admin/websites': Globe,
	'/admin/pinterest': Pin,
	'/admin/analytics': BarChart3,
	'/admin/queue': ListOrdered,
	'/admin/jobs': Briefcase,
	'/admin/logs': ScrollText,
	'/admin/notifications': Bell,
	'/admin/settings': Settings,
	'/admin/system': Activity,
};

function NavItems({ onNavigate }) {
	return (
		<nav className="admin-nav" aria-label="Admin console">
			{ADMIN_NAV.map((item) => {
				const Icon = ICONS[item.to] || Shield;
				return (
					<NavLink
						key={item.to}
						to={item.to}
						end={Boolean(item.end)}
						onClick={onNavigate}
						className={({ isActive }) => (isActive ? 'is-active' : undefined)}
					>
						<Icon size={15} aria-hidden="true" />
						{item.label}
					</NavLink>
				);
			})}
		</nav>
	);
}

export default function AdminLayout() {
	const [mobileOpen, setMobileOpen] = useState(false);
	const { user, logout } = useAuth();
	const navigate = useNavigate();
	const location = useLocation();

	const current = useMemo(() => {
		const match = ADMIN_NAV.find((item) => (
			item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
		));
		return match || { to: '/admin/dashboard', label: 'Admin Console' };
	}, [location.pathname]);

	const handleLogout = () => {
		logout();
		navigate('/login');
	};

	const brand = (
		<Link to="/admin/dashboard" className="admin-sidebar__brand" onClick={() => setMobileOpen(false)}>
			<span className="admin-sidebar__mark"><Shield size={16} aria-hidden="true" /></span>
			<span>
				<span className="admin-sidebar__tag">Super User</span>
				<span className="admin-sidebar__name">Admin Console</span>
			</span>
		</Link>
	);

	return (
		<div className="admin-console">
			<aside className="admin-sidebar">
				{brand}
				<NavItems />
				<button type="button" className="admin-btn" onClick={() => navigate('/app')}>
					<ArrowLeftRight size={14} aria-hidden="true" /> Open Workspace
				</button>
			</aside>

			{mobileOpen ? (
				<div
					className="admin-drawer"
					role="dialog"
					aria-modal="true"
					aria-label="Admin navigation"
					onClick={() => setMobileOpen(false)}
				>
					<div className="admin-drawer__panel" onClick={(event) => event.stopPropagation()}>
						<div className="flex items-center justify-between gap-2">
							{brand}
							<button type="button" className="admin-icon-btn" onClick={() => setMobileOpen(false)} aria-label="Close menu">
								<X size={16} />
							</button>
						</div>
						<NavItems onNavigate={() => setMobileOpen(false)} />
						<button type="button" className="admin-btn" onClick={() => { setMobileOpen(false); navigate('/app'); }}>
							<ArrowLeftRight size={14} aria-hidden="true" /> Open Workspace
						</button>
					</div>
				</div>
			) : null}

			<div className="admin-main">
				<header className="admin-header">
					<div className="flex items-center gap-2 min-w-0">
						<button type="button" className="admin-icon-btn admin-only-mobile" onClick={() => setMobileOpen(true)} aria-label="Open menu">
							<Menu size={16} />
						</button>
						<div className="min-w-0">
							<nav className="admin-breadcrumb" aria-label="Breadcrumb">
								<Link to="/admin/dashboard">Admin</Link>
								<ChevronRight size={12} aria-hidden="true" />
								<span aria-current="page">{current.label}</span>
							</nav>
							<p className="admin-header__title">{current.label}</p>
							<p className="admin-header__meta">Chef IA platform · {user?.email || 'administrator'}</p>
						</div>
					</div>
					<div className="admin-header__actions">
						<button type="button" className="admin-icon-btn" aria-label="Notifications" title="Notifications (UI only)">
							<Bell size={15} />
						</button>
						<button type="button" className="admin-btn" onClick={handleLogout}>
							<LogOut size={14} aria-hidden="true" />
							<span className="admin-btn-label">Sign out</span>
						</button>
					</div>
				</header>

				<main className="admin-content">
					<Outlet />
				</main>

				<footer className="admin-footer">
					<span>Chef IA Admin Console · frontend architecture only</span>
					<span>Version 0.0.0 · Mock data · No API wiring</span>
				</footer>
			</div>
		</div>
	);
}
