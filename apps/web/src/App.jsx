import { Suspense, lazy } from 'react';
import { Route, Routes, BrowserRouter as Router } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import ScrollToTop from '@/components/ScrollToTop';
import AppLayout from '@/components/AppLayout';
import { ProtectedRoute, Spinner } from '@/components/kit';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';

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

function Shell({ children, admin }) {
	return (
		<ProtectedRoute admin={admin}>
			<AppLayout>{children}</AppLayout>
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
						<Route path="*" element={<NotFoundPage />} />
					</Routes>
					<Toaster />
				</Router>
			</AuthProvider>
		</ThemeProvider>
	);
}

export default App;
