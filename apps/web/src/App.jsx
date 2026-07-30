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
import { WorkspaceProvider } from '@/context/WorkspaceContext';

import LandingPage from '@/pages/LandingPage';
import LegalPage from '@/pages/LegalPage';
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
const TemplatesClassicPage = lazy(() => import('@/pages/app/TemplatesClassicPage'));
const TemplateEditorPage = lazy(() => import('@/pages/app/TemplateEditorPage'));
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
const AdminLegalPagesPage = lazy(() => import('@/pages/admin/AdminLegalPagesPage'));
const AdminSettingsPage = lazy(() => import('@/pages/admin/AdminSettingsPage'));
const AdminSystemPage = lazy(() => import('@/pages/admin/AdminSystemPage'));
const AdminBillingProvidersPage = lazy(() => import('@/pages/admin/billing/AdminBillingProvidersPage'));
const AdminBillingLogsPage = lazy(() => import('@/pages/admin/billing/AdminBillingLogsPage'));
const AdminBillingHealthPage = lazy(() => import('@/pages/admin/billing/AdminBillingHealthPage'));
const AdminBillingDashboardPage = lazy(() => import('@/pages/admin/billing/AdminBillingDashboardPage'));
const AdminBillingPriceMappingPage = lazy(() => import('@/pages/admin/billing/AdminBillingPriceMappingPage'));
const AdminBillingPlaceholderPage = lazy(() => import('@/pages/admin/billing/AdminBillingPlaceholderPage'));

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
					<WorkspaceProvider>
						<ScrollToTop />
						<Routes>
						<Route path="/" element={<LandingPage />} />
						<Route path="/privacy" element={<LegalPage slug="privacy" />} />
						<Route path="/terms" element={<LegalPage slug="terms" />} />
						<Route path="/cookies" element={<LegalPage slug="cookies" />} />
						<Route path="/disclaimer" element={<LegalPage slug="disclaimer" />} />
						<Route path="/refund" element={<LegalPage slug="refund" />} />
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
						<Route path="/app/ai-pins/templates/classic" element={<Shell><LazyPage><TemplatesClassicPage /></LazyPage></Shell>} />
						<Route path="/app/ai-pins/templates/new/edit" element={<Shell><LazyPage><TemplateEditorPage /></LazyPage></Shell>} />
						<Route path="/app/ai-pins/templates/:id/edit" element={<Shell><LazyPage><TemplateEditorPage /></LazyPage></Shell>} />
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
							<Route path="billing" element={<AdminLazy><AdminBillingDashboardPage /></AdminLazy>} />
							<Route path="billing/providers" element={<AdminLazy><AdminBillingProvidersPage /></AdminLazy>} />
							<Route path="billing/logs" element={<AdminLazy><AdminBillingLogsPage /></AdminLazy>} />
							<Route path="billing/health" element={<AdminLazy><AdminBillingHealthPage /></AdminLazy>} />
							<Route path="billing/price-mapping" element={<AdminLazy><AdminBillingPriceMappingPage /></AdminLazy>} />
							<Route path="billing/events" element={<AdminLazy><AdminBillingPlaceholderPage title="Payment Events" description="Runtime billing_events monitor arrives in a later phase." phaseKey="events" /></AdminLazy>} />
							<Route path="billing/webhooks" element={<AdminLazy><AdminBillingPlaceholderPage title="Webhook Monitor" description="billing_idempotency monitor arrives in a later phase." phaseKey="webhooks" /></AdminLazy>} />
							<Route path="billing/monitoring" element={<AdminLazy><AdminBillingPlaceholderPage title="Billing Monitoring" description="Enterprise monitoring widgets arrive in a later phase." phaseKey="monitoring" /></AdminLazy>} />
							<Route path="billing/backup" element={<AdminLazy><AdminBillingPlaceholderPage title="Backup & Restore" description="Billing configuration backup and restore arrive in a later phase." phaseKey="backup" /></AdminLazy>} />
							<Route path="providers" element={<AdminLazy><AdminProvidersPage /></AdminLazy>} />
							<Route path="models" element={<AdminLazy><AdminModelsPage /></AdminLazy>} />
							<Route path="websites" element={<AdminLazy><AdminWebsitesPage /></AdminLazy>} />
							<Route path="pinterest" element={<AdminLazy><AdminPinterestPage /></AdminLazy>} />
							<Route path="analytics" element={<AdminLazy><AdminAnalyticsPage /></AdminLazy>} />
							<Route path="queue" element={<AdminLazy><AdminQueuePage /></AdminLazy>} />
							<Route path="jobs" element={<AdminLazy><AdminJobsPage /></AdminLazy>} />
							<Route path="logs" element={<AdminLazy><AdminLogsPage /></AdminLazy>} />
							<Route path="notifications" element={<AdminLazy><AdminNotificationsPage /></AdminLazy>} />
							<Route path="legal-pages" element={<AdminLazy><AdminLegalPagesPage /></AdminLazy>} />
							<Route path="settings" element={<AdminLazy><AdminSettingsPage /></AdminLazy>} />
							<Route path="system" element={<AdminLazy><AdminSystemPage /></AdminLazy>} />
						</Route>

						<Route path="*" element={<NotFoundPage />} />
					</Routes>
					<Toaster />
					</WorkspaceProvider>
				</Router>
			</AuthProvider>
		</ThemeProvider>
	);
}

export default App;
