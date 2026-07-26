import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Sparkles, ArrowLeft } from 'lucide-react';
import './auth/AuthShell.css';
import './PrivacyPolicyPage.css';

const LAST_UPDATED = 'July 26, 2026';
const SITE_URL = 'https://tbuy.store';
const PRIVACY_EMAIL = 'privacy@tbuy.store';
const SUPPORT_EMAIL = 'support@tbuy.store';

const TOC = [
	{ id: 'introduction', label: 'Introduction' },
	{ id: 'information-collected', label: 'Information we collect' },
	{ id: 'authentication', label: 'Authentication' },
	{ id: 'workspace-data', label: 'Workspace data' },
	{ id: 'website-connections', label: 'Website connections' },
	{ id: 'wordpress', label: 'WordPress integration' },
	{ id: 'pinterest', label: 'Pinterest OAuth' },
	{ id: 'ai-providers', label: 'AI providers' },
	{ id: 'cookies', label: 'Cookies' },
	{ id: 'analytics', label: 'Analytics' },
	{ id: 'retention', label: 'Data retention' },
	{ id: 'rights', label: 'Your rights' },
	{ id: 'security', label: 'Security' },
	{ id: 'children', label: 'Children’s privacy' },
	{ id: 'international', label: 'International transfers' },
	{ id: 'changes', label: 'Changes to this policy' },
	{ id: 'contact', label: 'Contact' },
];

export default function PrivacyPolicyPage() {
	useEffect(() => {
		window.scrollTo(0, 0);
	}, []);

	return (
		<div className="welcome-atelier privacy-page text-foreground">
			<Helmet>
				<title>Privacy Policy | Chef IA</title>
				<meta
					name="description"
					content="Learn how Chef IA collects, uses, and protects your account, workspace, website, WordPress, Pinterest, and AI-related data on tbuy.store."
				/>
				<link rel="canonical" href={`${SITE_URL}/privacy`} />
				<meta property="og:title" content="Privacy Policy | Chef IA" />
				<meta
					property="og:description"
					content="Chef IA privacy practices for accounts, workspaces, publishing integrations, AI providers, cookies, and your data rights."
				/>
				<meta property="og:url" content={`${SITE_URL}/privacy`} />
				<meta property="og:type" content="website" />
			</Helmet>

			<header className="welcome-nav">
				<div className="mx-auto flex max-w-[76rem] items-center justify-between px-5 py-4">
					<Link to="/" className="auth-brand">
						<span className="auth-brand__mark"><Sparkles size={18} /></span>
						<span className="auth-brand__name">Chef IA</span>
					</Link>
					<div className="flex items-center gap-2">
						<Link to="/login" className="rounded-xl px-4 py-2 text-sm font-medium hover:bg-secondary">Log in</Link>
						<Link to="/signup" className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
							Get started
						</Link>
					</div>
				</div>
			</header>

			<main className="privacy-main">
				<div className="privacy-hero">
					<Link to="/" className="privacy-back">
						<ArrowLeft size={14} /> Back to Chef IA
					</Link>
					<p className="auth-hero__eyebrow">Legal</p>
					<h1 className="privacy-title">Privacy Policy</h1>
					<p className="privacy-lead">
						This Privacy Policy explains how Chef IA (“Chef IA,” “we,” “us,” or “our”) collects, uses, shares, and protects
						personal information when you use our website and services at {SITE_URL} and related applications.
					</p>
					<p className="privacy-meta">Last updated: {LAST_UPDATED}</p>
				</div>

				<div className="privacy-layout">
					<nav className="privacy-toc" aria-label="Privacy Policy sections">
						<p className="privacy-toc__label">On this page</p>
						<ul>
							{TOC.map((item) => (
								<li key={item.id}>
									<a href={`#${item.id}`}>{item.label}</a>
								</li>
							))}
						</ul>
					</nav>

					<article className="privacy-content">
						<section id="introduction">
							<h2>1. Introduction</h2>
							<p>
								Chef IA is an AI-assisted content and publishing platform that helps creators write SEO-ready articles,
								generate images and Pinterest pins, manage brand kits and templates, and publish to connected websites,
								WordPress sites, and Pinterest accounts.
							</p>
							<p>
								By creating an account, connecting third-party services, or otherwise using Chef IA, you acknowledge that
								your information will be handled as described in this Privacy Policy. If you do not agree, please do not
								use the Service.
							</p>
						</section>

						<section id="information-collected">
							<h2>2. Information we collect</h2>
							<p>We collect information in the following categories:</p>
							<h3>Account and profile information</h3>
							<ul>
								<li>Name, email address, and password (or credentials created through supported sign-in methods).</li>
								<li>Workspace name, profile preferences, plan selection, and billing-related account status.</li>
								<li>Communications you send to us, including support requests and feedback.</li>
							</ul>
							<h3>Usage and technical information</h3>
							<ul>
								<li>Log data such as IP address, browser type, device information, approximate location derived from IP, pages viewed, and timestamps.</li>
								<li>Diagnostic events related to authentication, publishing jobs, queue processing, and error reports needed to operate and secure the Service.</li>
							</ul>
							<h3>Content and operational data you provide</h3>
							<ul>
								<li>Articles, prompts, pin titles and descriptions, templates, brand kits, images, schedules, and publishing history you create or upload.</li>
								<li>Website, WordPress, and Pinterest connection metadata required to perform the features you enable.</li>
							</ul>
							<p>
								We do not sell your personal information. We process it to provide the Service, improve reliability and
								security, communicate with you, and comply with applicable law.
							</p>
						</section>

						<section id="authentication">
							<h2>3. Authentication</h2>
							<p>
								Chef IA authenticates users through secure account credentials managed by our platform infrastructure.
								Session tokens and related authentication artifacts are used to keep you signed in and to authorize API
								requests to your workspace.
							</p>
							<ul>
								<li>Passwords are stored using industry-standard hashing practices and are never stored in plain text.</li>
								<li>Access tokens for connected services are stored encrypted at rest where applicable and used only to perform actions you request.</li>
								<li>You are responsible for maintaining the confidentiality of your login credentials and for activity under your account.</li>
							</ul>
							<p>
								If you believe your account has been compromised, contact us immediately at{' '}
								<a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
							</p>
						</section>

						<section id="workspace-data">
							<h2>4. Workspace data</h2>
							<p>
								Each Chef IA account operates within one or more workspaces. Workspace data may include team or owner
								settings, connected sites and accounts, content drafts, generation history, publishing queues, calendars,
								analytics summaries, notification preferences, and credit or subscription usage.
							</p>
							<p>
								Workspace data is accessible to authorized users of that workspace and to Chef IA personnel solely as
								needed to provide support, maintain the platform, investigate abuse or security incidents, or meet legal
								obligations. We do not use your private workspace content to train public models for unrelated third parties.
							</p>
						</section>

						<section id="website-connections">
							<h2>5. Website connections</h2>
							<p>
								When you add a website to Chef IA, we may store the site URL, display name, discovery settings, article
								metadata you sync or import, and related destination links used for pin publishing.
							</p>
							<p>
								This information is used to associate generated content with the correct site, resolve destination URLs for
								Pinterest pins, and display site-level history and analytics inside your workspace. You control which
								websites remain connected and may disconnect them at any time from workspace settings.
							</p>
						</section>

						<section id="wordpress">
							<h2>6. WordPress integration</h2>
							<p>
								If you connect a WordPress site, Chef IA stores the connection details required to authenticate and publish
								on your behalf, which may include site URL, authentication credentials or application passwords, author
								mapping, and publish status records.
							</p>
							<ul>
								<li>Credentials are used only to create, update, or manage content and media you choose to publish.</li>
								<li>We retain WordPress API request logs and publish history as needed for troubleshooting, auditability, and your Publishing Center.</li>
								<li>Disconnecting WordPress stops future publishing through that connection. Previously published posts remain on your WordPress site unless you remove them there.</li>
							</ul>
							<p>
								WordPress is operated by Automattic and related service providers. Their handling of data on your site is
								governed by your WordPress hosting arrangement and applicable WordPress policies.
							</p>
						</section>

						<section id="pinterest">
							<h2>7. Pinterest OAuth</h2>
							<p>
								When you connect Pinterest, Chef IA uses Pinterest’s OAuth 2.0 flow. With your authorization, we may receive
								and store account identifiers, username or profile details, granted OAuth scopes, access and refresh tokens,
								board identifiers and names, and pin publish results.
							</p>
							<ul>
								<li>Tokens are used to create and manage pins, sync boards, and retrieve related publishing status for your connected accounts.</li>
								<li>We store the OAuth application identifiers associated with your connection so we can validate that tokens belong to the configured Chef IA Pinterest developer app.</li>
								<li>You may disconnect Pinterest accounts from Chef IA at any time. Disconnecting cancels pending publish jobs tied to that account where technically feasible.</li>
							</ul>
							<p>
								Pinterest’s processing of your Pinterest account data is governed by Pinterest’s own privacy policy and
								developer terms. Chef IA’s ability to create pins in production also depends on the access tier approved for
								our Pinterest developer application by Pinterest.
							</p>
						</section>

						<section id="ai-providers">
							<h2>8. AI providers (OpenAI, Gemini, and others)</h2>
							<p>
								Chef IA uses third-party AI providers to generate text, images, and related outputs. Depending on platform
								configuration and the features you use, this may include providers such as OpenAI, Google Gemini, Fal.ai,
								and other models enabled by the Chef IA Admin Console.
							</p>
							<ul>
								<li>Prompts, reference images, article excerpts, brand settings, and other inputs you submit for generation may be transmitted to the selected provider to fulfill your request.</li>
								<li>Provider API keys are managed by Chef IA for platform-operated providers and are not exposed to end users.</li>
								<li>Providers process data under their own terms and privacy policies. We configure providers for service delivery and do not sell your prompts as a standalone data product.</li>
							</ul>
							<p>
								Generated outputs are stored in your workspace so you can review, edit, schedule, and publish them. You are
								responsible for reviewing AI-generated content before publishing and for ensuring it complies with applicable
								laws and third-party platform rules.
							</p>
						</section>

						<section id="cookies">
							<h2>9. Cookies</h2>
							<p>
								Chef IA uses cookies and similar technologies that are necessary to operate the Service, maintain secure
								sessions, remember preferences such as theme settings, and protect against abuse.
							</p>
							<ul>
								<li><strong>Essential cookies:</strong> required for authentication, security, and core product functionality.</li>
								<li><strong>Preference cookies:</strong> remember settings such as interface preferences where available.</li>
								<li><strong>Analytics cookies:</strong> may be used where enabled to understand aggregate product usage and improve reliability.</li>
							</ul>
							<p>
								You can control cookies through your browser settings. Disabling essential cookies may prevent sign-in or
								other core features from working correctly.
							</p>
						</section>

						<section id="analytics">
							<h2>10. Analytics</h2>
							<p>
								Chef IA provides in-product analytics for your workspace, such as counts of articles, images, published
								pins, scheduled jobs, and related performance summaries derived from your own connected accounts and
								publishing activity.
							</p>
							<p>
								We also collect operational analytics about Service usage (for example, feature adoption, error rates, and
								queue health) to monitor platform performance, prevent abuse, and improve Chef IA. These metrics are used
								for product operations and are not sold to data brokers.
							</p>
						</section>

						<section id="retention">
							<h2>11. Data retention</h2>
							<p>
								We retain personal information and workspace data for as long as your account remains active and as needed
								to provide the Service. Specific records may be retained longer when required for security, dispute
								resolution, legal compliance, backups, or audit logs.
							</p>
							<ul>
								<li>Account and workspace content generally remain until you delete the relevant items or close your account.</li>
								<li>Publishing jobs, API logs, and audit events may be retained for operational integrity and troubleshooting for a limited period.</li>
								<li>Encrypted third-party tokens are retained while the related connection remains active and are removed or invalidated when you disconnect the service or delete the account, subject to backup cycles.</li>
							</ul>
							<p>
								After account deletion requests are processed, residual copies may persist in encrypted backups for a limited
								time until those backups rotate out according to our retention schedule.
							</p>
						</section>

						<section id="rights">
							<h2>12. Your rights</h2>
							<p>
								Depending on your location, you may have rights to access, correct, export, restrict, or delete personal
								information we hold about you, and to object to certain processing. You may also have the right to lodge a
								complaint with a supervisory authority where applicable.
							</p>
							<p>To exercise these rights, contact us at{' '}
								<a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>. We may need to verify your identity before fulfilling
								a request. Some requests can also be completed directly in the product, such as updating profile details,
								disconnecting integrations, or deleting drafts and connected accounts you no longer need.
							</p>
						</section>

						<section id="security">
							<h2>13. Security</h2>
							<p>
								We implement administrative, technical, and organizational measures designed to protect personal information,
								including encrypted transport (HTTPS), access controls, encrypted storage of sensitive credentials where
								applicable, least-privilege operational access, and monitoring of authentication and publishing systems.
							</p>
							<p>
								No method of transmission or storage is completely secure. While we work to protect your information, we
								cannot guarantee absolute security. Please use a unique, strong password and limit access to your workspace
								to trusted collaborators.
							</p>
						</section>

						<section id="children">
							<h2>14. Children’s privacy</h2>
							<p>
								Chef IA is intended for business and creator use by adults. The Service is not directed to children under
								16, and we do not knowingly collect personal information from children. If you believe a child has provided
								personal information to us, contact {PRIVACY_EMAIL} and we will take appropriate steps to delete it.
							</p>
						</section>

						<section id="international">
							<h2>15. International transfers</h2>
							<p>
								Chef IA is operated from infrastructure that may process data in the United States and other countries where
								our service providers maintain facilities. If you access the Service from outside those locations, your
								information may be transferred to and processed in countries that may have different data-protection laws
								than your own. We take steps designed to ensure appropriate protections for such transfers where required.
							</p>
						</section>

						<section id="changes">
							<h2>16. Changes to this policy</h2>
							<p>
								We may update this Privacy Policy from time to time. When we do, we will revise the “Last updated” date at
								the top of this page and, when changes are material, provide additional notice through the Service or by
								email where appropriate. Continued use of Chef IA after an update becomes effective constitutes acceptance
								of the revised policy.
							</p>
						</section>

						<section id="contact">
							<h2>17. Contact</h2>
							<p>
								If you have questions about this Privacy Policy or how Chef IA handles personal information, contact us:
							</p>
							<ul>
								<li>Privacy inquiries: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a></li>
								<li>Product support: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></li>
								<li>Website: <a href={SITE_URL}>{SITE_URL}</a></li>
							</ul>
							<p>
								Chef IA<br />
								Privacy Team<br />
								Available online at {SITE_URL}/privacy
							</p>
						</section>
					</article>
				</div>
			</main>

			<footer className="border-t border-border/80">
				<div className="mx-auto flex max-w-[76rem] flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-2">
						<span className="auth-brand__mark !h-8 !w-8"><Sparkles size={14} /></span>
						<span className="font-display font-semibold text-foreground">Chef IA</span>
					</div>
					<div className="auth-footer__links">
						<Link to="/privacy">Privacy Policy</Link>
						<a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
						<a href={`mailto:${PRIVACY_EMAIL}`}>Contact</a>
					</div>
				</div>
			</footer>
		</div>
	);
}
