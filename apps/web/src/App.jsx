import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, BrowserRouter as Router } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import ScrollToTop from '@/components/ScrollToTop';
import AppLayout from '@/components/AppLayout';
import AdminLayout from '@/components/admin/AdminLayout';
import AdminRoute from '@/components/admin/AdminRoute';
import { ProtectedRoute, Spinner } from '@/components/kit';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { WorkspaceConfigProvider } from '@/context/WorkspaceConfigContext';

import LandingPage from '@/pages/LandingPage';
import LoginPage from '@/pages/auth/LoginPage';
import SignupPage from '@/pages/auth/SignupPage';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import DashboardPage from '@/pages/app/DashboardPage';
import WebsitesPage from '@/pages/app/WebsitesPage';
import WebsiteDashboardPage from '@/pages/app/WebsiteDashboardPage';
import WebsiteArticlesPage from '@/pages/app/WebsiteArticlesPage';
import WriterPage from '@/pages/app/WriterPage';
import ImagesPage from '@/pages/app/ImagesPage';
import SubscriptionPage from '@/pages/app/SubscriptionPage';
import SettingsPage from '@/pages/app/SettingsPage';
import ProfilePage from '@/pages/app/ProfilePage';
import AdminPage from '@/pages/app/AdminPage';
import NotFoundPage from '@/pages/NotFoundPage';

const AIPinsPage = lazy(() => import('@/pages/app/AIPinsPage'));
const TemplatesPage = lazy(() => import('@/pages/app/TemplatesPage'));
const BrandKitPage = lazy(() => import('@/pages/app/BrandKitPage'));
const AIPinHistoryPage = lazy(() => import('@/pages/app/AIPinHistoryPage'));
const PinterestPage = lazy(() => import('@/pages/app/PinterestPage'));
const CalendarPage = lazy(() => import('@/pages/app/CalendarPage'));
const PublishingHistoryPage = lazy(() => import('@/pages/app/PublishingHistoryPage'));
const AnalyticsPage = lazy(() => import('@/pages/app/AnalyticsPage'));

const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage'));
const AdminUsersPage = lazy(() => import('@/pages/admin/AdminUsersPage'));
const AdminWorkspacesPage = lazy(() => import('@/pages/admin/AdminWorkspacesPage'));
const AdminPlansPage = lazy(() => import('@/pages/admin/AdminPlansPage'));
const AdminCreditsPage = lazy(() => import('@/pages/admin/AdminCreditsPage'));
const AdminProvidersPage = lazy(() => import('@/pages/admin/AdminProvidersPage'));
const AdminModelsPage = lazy(() => import('@/pages/admin/AdminModelsPage'));
const AdminWebsitesPage = lazy(() => import('@/pages/admin/AdminWebsitesPage'));
const AdminPinterestPage = lazy(() => import('@/pages/admin/AdminPinterestPage'));
const AdminAnalyticsPage = lazy(() => import('@/pages/admin/AdminAnalyticsPage'));
const AdminQueuePage = lazy(() => import('@/pages/admin/AdminQueuePage'));
const AdminJobsPage = lazy(() => import('@/pages/admin/AdminJobsPage'));
const AdminLogsPage = lazy(() => import('@/pages/admin/AdminLogsPage'));
const AdminNotificationsPage = lazy(() => import('@/pages/admin/AdminNotificationsPage'));
const AdminSettingsPage = lazy(() => import('@/pages/admin/AdminSettingsPage'));
const AdminSystemPage = lazy(() => import('@/pages/admin/AdminSystemPage'));

function Shell({ children, admin }) {
	return (
		<ProtectedRoute admin={admin}>
			<WorkspaceConfigProvider>
				<AppLayout>{children}</AppLayout>
			</WorkspaceConfigProvider>
		</ProtectedRoute>
	);
}

function LazyPage({ children }) {
	return (
		<Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center"><Spinner className="h-5 w-5" /></div>}>
			{children}
		</Suspense>
	);
}

function AdminShell() {
	return (
		<AdminRoute>
			<AdminLayout />
		</AdminRoute>
	);
}

function AdminLazy({ children }) {
	return (
		<Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center text-[#e8a87c]"><Spinner /></div>}>
			{children}
		</Suspense>
	);
}

function App() {
	return (
		<ThemeProvider>
			<AuthProvider>
				<Router>
					<ScrollToTop />
					<Routes>
						<Route path="/" element={<LandingPage />} />
						<Route path="/login" element={<LoginPage />} />
						<Route path="/signup" element={<SignupPage />} />
						<Route path="/forgot-password" element={<ForgotPasswordPage />} />

						{/* Customer Workspace ÔÇö unchanged */}
						<Route path="/app" element={<Shell><DashboardPage /></Shell>} />
						<Route path="/app/websites" element={<Shell><WebsitesPage /></Shell>} />
						<Route path="/app/websites/:websiteId" element={<Shell><WebsiteDashboardPage /></Shell>} />
						<Route path="/app/websites/:websiteId/articles" element={<Shell><WebsiteArticlesPage /></Shell>} />
						<Route path="/app/ai-pins" element={<Shell><LazyPage><AIPinsPage /></LazyPage></Shell>} />
						<Route path="/app/ai-pins/templates" element={<Shell><LazyPage><TemplatesPage /></LazyPage></Shell>} />
						<Route path="/app/ai-pins/brand-kit" element={<Shell><LazyPage><BrandKitPage /></LazyPage></Shell>} />
						<Route path="/app/ai-pins/history" element={<Shell><LazyPage><AIPinHistoryPage /></LazyPage></Shell>} />
						<Route path="/app/writer" element={<Shell><WriterPage /></Shell>} />
						<Route path="/app/images" element={<Shell><ImagesPage /></Shell>} />
						<Route path="/app/pinterest" element={<Shell><LazyPage><PinterestPage /></LazyPage></Shell>} />
						<Route path="/app/calendar" element={<Shell><LazyPage><CalendarPage /></LazyPage></Shell>} />
						<Route path="/app/pinterest-history" element={<Shell><LazyPage><PublishingHistoryPage /></LazyPage></Shell>} />
						<Route path="/app/analytics" element={<Shell><LazyPage><AnalyticsPage /></LazyPage></Shell>} />
						<Route path="/app/subscription" element={<Shell><SubscriptionPage /></Shell>} />
						<Route path="/app/settings" element={<Shell><SettingsPage /></Shell>} />
						<Route path="/app/profile" element={<Shell><ProfilePage /></Shell>} />
						<Route path="/app/admin" element={<Shell admin><AdminPage /></Shell>} />

						{/* Super User Admin Console ÔÇö separate application area */}
						<Route path="/admin" element={<AdminShell />}>
							<Route index element={<Navigate to="dashboard" replace />} />
							<Route path="dashboard" element={<AdminLazy><AdminDashboardPage /></AdminLazy>} />
							<Route path="users" element={<AdminLazy><AdminUsersPage /></AdminLazy>} />
							<Route path="workspaces" element={<AdminLazy><AdminWorkspacesPage /></AdminLazy>} />
							<Route path="plans" element={<AdminLazy><AdminPlansPage /></AdminLazy>} />
							<Route path="credits" element={<AdminLazy><AdminCreditsPage /></AdminLazy>} />
							<Route path="providers" element={<AdminLazy><AdminProvidersPage /></AdminLazy>} />
							<Route path="models" element={<AdminLazy><AdminModelsPage /></AdminLazy>} />
							<Route path="websites" element={<AdminLazy><AdminWebsitesPage /></AdminLazy>} />
							<Route path="pinterest" element={<AdminLazy><AdminPinterestPage /></AdminLazy>} />
							<Route path="analytics" element={<AdminLazy><AdminAnalyticsPage /></AdminLazy>} />
							<Route path="queue" element={<AdminLazy><AdminQueuePage /></AdminLazy>} />
							<Route path="jobs" element={<AdminLazy><AdminJobsPage /></AdminLazy>} />
							<Route path="logs" element={<AdminLazy><AdminLogsPage /></AdminLazy>} />
							<Route path="notifications" element={<AdminLazy><AdminNotificationsPage /></AdminLazy>} />
							<Route path="settings" element={<AdminLazy><AdminSettingsPage /></AdminLazy>} />
							<Route path="system" element={<AdminLazy><AdminSystemPage /></AdminLazy>} />
						</Route>

						<Route path="*" element={<NotFoundPage />} />
					</Routes>
					<Toaster />
				</Router>
			</AuthProvider>
		</ThemeProvider>
	);
}

export default App;
