/**
 * Production default legal page templates for Chef IA.
 * Used by auto-seed and Admin Quick Start. Status is always draft.
 *
 * Branding placeholders are materialized from Platform Identity at seed/quick-start time.
 * Existing user-created legal pages are never rewritten by this module.
 */

export const SITE_URL = 'https://tbuy.store';
export const PRIVACY_EMAIL = 'privacy@tbuy.store';
export const SUPPORT_EMAIL = 'support@tbuy.store';
export const PLATFORM_NAME = 'Chef IA';

export const DEFAULT_LEGAL_BRAND = Object.freeze({
	platformName: PLATFORM_NAME,
	siteUrl: SITE_URL,
	supportEmail: SUPPORT_EMAIL,
	privacyEmail: PRIVACY_EMAIL,
});

export function resolveLegalBrandContext(input = {}) {
	const platformName = String(input.platformName || '').trim() || DEFAULT_LEGAL_BRAND.platformName;
	const siteUrl = String(input.siteUrl || input.appUrl || '').trim().replace(/\/$/, '')
		|| DEFAULT_LEGAL_BRAND.siteUrl;
	const supportEmail = String(input.supportEmail || '').trim() || DEFAULT_LEGAL_BRAND.supportEmail;
	// Privacy email SoT: contact.privacyEmail alias → contact.contactEmail → fallback
	const privacyEmail = String(
		input.privacyEmail || input.contactEmail || '',
	).trim() || DEFAULT_LEGAL_BRAND.privacyEmail;

	return {
		platformName,
		siteUrl,
		supportEmail,
		privacyEmail,
	};
}

function hostnameFromSiteUrl(siteUrl) {
	try {
		return new URL(siteUrl.includes('://') ? siteUrl : `https://${siteUrl}`).host;
	} catch {
		return 'tbuy.store';
	}
}

function materializeLegalText(value, brand) {
	const b = resolveLegalBrandContext(brand);
	const host = hostnameFromSiteUrl(b.siteUrl);
	return String(value || '')
		.replaceAll('https://tbuy.store', b.siteUrl)
		.replaceAll('support@tbuy.store', b.supportEmail)
		.replaceAll('privacy@tbuy.store', b.privacyEmail)
		.replaceAll('tbuy.store', host)
		.replaceAll('Chef IA', b.platformName);
}
function estimateReadingMinutes(content) {
	const words = String(content || '').trim().split(/\s+/).filter(Boolean).length;
	return Math.max(1, Math.ceil(words / 200));
}

function buildTemplate({
	slug,
	title,
	description,
	seoTitle,
	metaDescription,
	content,
}) {
	return {
		slug,
		title,
		description,
		path: `/${slug}`,
		seoTitle,
		metaDescription,
		content,
		status: 'draft',
		estimatedReadingMinutes: estimateReadingMinutes(content),
	};
}

const PRIVACY_CONTENT = `# Privacy Policy

**Last updated:** July 26, 2026

This Privacy Policy explains how Chef IA ("Chef IA," "we," "us," or "our") collects, uses, shares, and protects personal information when you use our website and services at ${SITE_URL} and related applications.

## 1. Introduction

Chef IA is an AI-assisted content and publishing platform that helps creators write SEO-ready articles, generate images and Pinterest pins, manage brand kits and templates, and publish to connected websites, WordPress sites, and Pinterest accounts.

By creating an account, connecting third-party services, or otherwise using Chef IA, you acknowledge that your information will be handled as described in this Privacy Policy. If you do not agree, please do not use the Service.

## 2. Information we collect

### Account and profile information
- Name, email address, and password (or credentials created through supported sign-in methods)
- Workspace name, profile preferences, plan selection, and billing-related account status
- Communications you send to us, including support requests and feedback

### Usage and technical information
- Log data such as IP address, browser type, device information, approximate location derived from IP, pages viewed, and timestamps
- Diagnostic events related to authentication, publishing jobs, queue processing, and error reports needed to operate and secure the Service

### Content and operational data you provide
- Articles, prompts, pin titles and descriptions, templates, brand kits, images, schedules, and publishing history you create or upload
- Website, WordPress, and Pinterest connection metadata required to perform the features you enable

We do not sell your personal information. We process it to provide the Service, improve reliability and security, communicate with you, and comply with applicable law.

## 3. Authentication

Chef IA authenticates users through secure account credentials managed by our platform infrastructure. Session tokens and related authentication artifacts are used to keep you signed in and to authorize API requests to your workspace.

- Passwords are stored using industry-standard hashing practices and are never stored in plain text.
- Access tokens for connected services are stored encrypted at rest where applicable and used only to perform actions you request.
- You are responsible for maintaining the confidentiality of your login credentials and for activity under your account.

If you believe your account has been compromised, contact us immediately at ${SUPPORT_EMAIL}.

## 4. Workspace data

Each Chef IA account operates within one or more workspaces. Workspace data may include team or owner settings, connected sites and accounts, content drafts, generation history, publishing queues, calendars, analytics summaries, notification preferences, and credit or subscription usage.

Workspace data is accessible to authorized users of that workspace and to Chef IA personnel solely as needed to provide support, maintain the platform, investigate abuse or security incidents, or meet legal obligations. We do not use your private workspace content to train public models for unrelated third parties.

## 5. Website connections

When you add a website to Chef IA, we may store the site URL, display name, discovery settings, article metadata you sync or import, and related destination links used for pin publishing.

This information is used to associate generated content with the correct site, resolve destination URLs for Pinterest pins, and display site-level history and analytics inside your workspace. You control which websites remain connected and may disconnect them at any time from workspace settings.

## 6. WordPress integration

If you connect a WordPress site, Chef IA stores the connection details required to authenticate and publish on your behalf, which may include site URL, authentication credentials or application passwords, author mapping, and publish status records.

- Credentials are used only to create, update, or manage content and media you choose to publish.
- We retain WordPress API request logs and publish history as needed for troubleshooting, auditability, and your Publishing Center.
- Disconnecting WordPress stops future publishing through that connection. Previously published posts remain on your WordPress site unless you remove them there.

WordPress is operated by Automattic and related service providers. Their handling of data on your site is governed by your WordPress hosting arrangement and applicable WordPress policies.

## 7. Pinterest OAuth

When you connect Pinterest, Chef IA uses Pinterest’s OAuth 2.0 flow. With your authorization, we may receive and store account identifiers, username or profile details, granted OAuth scopes, access and refresh tokens, board identifiers and names, and pin publish results.

- Tokens are used to create and manage pins, sync boards, and retrieve related publishing status for your connected accounts.
- We store the OAuth application identifiers associated with your connection so we can validate that tokens belong to the configured Chef IA Pinterest developer app.
- You may disconnect Pinterest accounts from Chef IA at any time. Disconnecting cancels pending publish jobs tied to that account where technically feasible.

Pinterest’s processing of your Pinterest account data is governed by Pinterest’s own privacy policy and developer terms.

## 8. AI providers (OpenAI, Gemini, and others)

Chef IA uses third-party AI providers to generate text, images, and related outputs. Depending on platform configuration and the features you use, this may include providers such as OpenAI, Google Gemini, Fal.ai, and other models enabled by the Chef IA Admin Console.

- Prompts, reference images, article excerpts, brand settings, and other inputs you submit for generation may be transmitted to the selected provider to fulfill your request.
- Provider API keys are managed by Chef IA for platform-operated providers and are not exposed to end users.
- Providers process data under their own terms and privacy policies.

Generated outputs are stored in your workspace so you can review, edit, schedule, and publish them. You are responsible for reviewing AI-generated content before publishing.

## 9. Cookies

Chef IA uses cookies and similar technologies that are necessary to operate the Service, maintain secure sessions, remember preferences such as theme settings, and protect against abuse.

- **Essential cookies:** required for authentication, security, and core product functionality.
- **Preference cookies:** remember settings such as interface preferences where available.
- **Analytics cookies:** may be used where enabled to understand aggregate product usage and improve reliability.

You can control cookies through your browser settings. Disabling essential cookies may prevent sign-in or other core features from working correctly.

## 10. Analytics

Chef IA provides in-product analytics for your workspace, such as counts of articles, images, published pins, scheduled jobs, and related performance summaries derived from your own connected accounts and publishing activity.

We also collect operational analytics about Service usage to monitor platform performance, prevent abuse, and improve Chef IA. These metrics are used for product operations and are not sold to data brokers.

## 11. Data retention

We retain personal information and workspace data for as long as your account remains active and as needed to provide the Service. Specific records may be retained longer when required for security, dispute resolution, legal compliance, backups, or audit logs.

## 12. Your rights

Depending on your location, you may have rights to access, correct, export, restrict, or delete personal information we hold about you, and to object to certain processing.

To exercise these rights, contact us at ${PRIVACY_EMAIL}. We may need to verify your identity before fulfilling a request.

## 13. Security

We implement administrative, technical, and organizational measures designed to protect personal information, including encrypted transport (HTTPS), access controls, encrypted storage of sensitive credentials where applicable, least-privilege operational access, and monitoring of authentication and publishing systems.

No method of transmission or storage is completely secure. Please use a unique, strong password and limit access to your workspace to trusted collaborators.

## 14. Children’s privacy

Chef IA is intended for business and creator use by adults. The Service is not directed to children under 16, and we do not knowingly collect personal information from children. If you believe a child has provided personal information to us, contact ${PRIVACY_EMAIL}.

## 15. Contact

- Privacy inquiries: ${PRIVACY_EMAIL}
- Product support: ${SUPPORT_EMAIL}
- Website: ${SITE_URL}

Chef IA Privacy Team  
Available online at ${SITE_URL}/privacy
`;

const TERMS_CONTENT = `# Terms of Service

**Last updated:** July 26, 2026

These Terms of Service ("Terms") govern your access to and use of Chef IA at ${SITE_URL}. By creating an account or using the Service, you agree to these Terms.

## 1. The Service

Chef IA provides AI-assisted writing, image and pin generation, brand kits, templates, calendars, analytics, and publishing integrations with websites, WordPress, and Pinterest.

## 2. Accounts and workspaces

You must provide accurate registration information and keep your credentials secure. You are responsible for activity under your account and workspace. You must be at least 16 years old to use Chef IA.

## 3. Plans, credits, and billing

Paid plans, credits, and usage limits are described in the product. Fees are charged according to the plan you select. Unused credits may expire according to plan terms displayed in the product.

## 4. Acceptable use

You may not use Chef IA to:
- Violate applicable laws or third-party rights
- Publish spam, malware, or deceptive content
- Attempt to bypass security, rate limits, or access controls
- Misuse connected WordPress or Pinterest accounts
- Reverse engineer or disrupt the Service

## 5. Content ownership

You retain ownership of content you upload or create. You grant Chef IA a limited license to host, process, and transmit that content solely to operate the Service and complete actions you request, including AI generation and publishing.

## 6. AI-generated content

AI outputs may be inaccurate or incomplete. You are responsible for reviewing content before publishing and for compliance with SEO, advertising, copyright, and platform rules.

## 7. Third-party services

WordPress, Pinterest, OpenAI, Gemini, and other providers are governed by their own terms. Chef IA is not responsible for outages, policy changes, or access-tier restrictions imposed by those providers.

## 8. Termination

We may suspend or terminate accounts that violate these Terms or create security or abuse risk. You may stop using the Service and request account closure by contacting ${SUPPORT_EMAIL}.

## 9. Disclaimers and limitation of liability

The Service is provided "as is" to the fullest extent permitted by law. Chef IA is not liable for indirect, incidental, or consequential damages arising from use of the Service.

## 10. Contact

Questions about these Terms: ${SUPPORT_EMAIL}  
Website: ${SITE_URL}/terms
`;

const COOKIES_CONTENT = `# Cookie Policy

**Last updated:** July 26, 2026

This Cookie Policy explains how Chef IA uses cookies and similar technologies on ${SITE_URL}.

## 1. What are cookies?

Cookies are small text files stored on your device. They help websites remember sessions, preferences, and usage patterns.

## 2. Cookies we use

### Essential cookies
Required for authentication, security, CSRF protection, and core product functionality. The Service may not work correctly if these are blocked.

### Preference cookies
Remember interface choices such as theme or layout preferences where available.

### Analytics cookies
Help us understand aggregate product usage, reliability, and feature adoption so we can improve Chef IA.

## 3. Managing cookies

You can control cookies through your browser settings. Blocking essential cookies may prevent sign-in or workspace features from working.

## 4. Updates

We may update this Cookie Policy when our practices change. The "Last updated" date reflects the latest revision.

## 5. Contact

Questions: ${PRIVACY_EMAIL}  
Support: ${SUPPORT_EMAIL}  
Website: ${SITE_URL}/cookies
`;

const DISCLAIMER_CONTENT = `# Disclaimer

**Last updated:** July 26, 2026

The information and tools provided by Chef IA at ${SITE_URL} are for general business and creator use.

## 1. No professional advice

Chef IA does not provide legal, financial, tax, medical, or other professional advice. Content generated or published through the Service should be reviewed by qualified professionals where appropriate.

## 2. AI-generated content

Outputs from AI providers may contain errors, omissions, or content that is unsuitable for your audience. You are solely responsible for verifying accuracy, originality, and compliance before publishing.

## 3. Third-party platforms

Results on WordPress, Pinterest, and other connected services depend on those platforms’ availability, policies, and your account permissions. Chef IA is not responsible for rejected posts, sandbox restrictions, API access tiers, or account actions taken by third parties.

## 4. Availability

We strive for reliable uptime but do not guarantee uninterrupted access. Maintenance, outages, or dependency failures may affect publishing queues and generation features.

## 5. Contact

${SUPPORT_EMAIL}  
Privacy: ${PRIVACY_EMAIL}  
Website: ${SITE_URL}/disclaimer
`;

const REFUND_CONTENT = `# Refund Policy

**Last updated:** July 26, 2026

This Refund Policy explains how Chef IA handles subscription and credit-related refunds for services purchased through ${SITE_URL}.

## 1. Subscriptions

Unless required by applicable law, subscription fees are generally non-refundable once a billing period has started. If you cancel, you retain access through the end of the current paid period according to your plan settings.

## 2. Credits

Purchased or allocated credits are consumed when generation or publishing features are used. Consumed credits are not refundable. Unused credits may expire according to the terms shown in your billing workspace.

## 3. Billing errors

If you believe you were charged in error, contact ${SUPPORT_EMAIL} within 14 days of the charge and include your account email, invoice or receipt details, and a description of the issue. We will review eligible requests in good faith.

## 4. Chargebacks

Please contact support before initiating a chargeback so we can help resolve the issue. Fraudulent or abusive chargebacks may result in account suspension.

## 5. Contact

Billing support: ${SUPPORT_EMAIL}  
Privacy inquiries: ${PRIVACY_EMAIL}  
Website: ${SITE_URL}/refund
`;

export const LEGAL_PAGE_TEMPLATES = Object.freeze([
	buildTemplate({
		slug: 'privacy',
		title: 'Privacy Policy',
		description: 'Explain how Chef IA collects, uses, and protects account, workspace, WordPress, Pinterest, and AI data.',
		seoTitle: 'Privacy Policy | Chef IA',
		metaDescription: 'Learn how Chef IA collects, uses, and protects your account, workspace, website, WordPress, Pinterest, and AI-related data on tbuy.store.',
		content: PRIVACY_CONTENT,
	}),
	buildTemplate({
		slug: 'terms',
		title: 'Terms of Service',
		description: 'Define account rules, acceptable use, billing, AI content ownership, and third-party platform terms.',
		seoTitle: 'Terms of Service | Chef IA',
		metaDescription: 'Read the Chef IA Terms of Service governing account use, workspaces, publishing integrations, AI features, and acceptable use on tbuy.store.',
		content: TERMS_CONTENT,
	}),
	buildTemplate({
		slug: 'cookies',
		title: 'Cookie Policy',
		description: 'Describe essential, preference, and analytics cookies used to run secure sessions and improve Chef IA.',
		seoTitle: 'Cookie Policy | Chef IA',
		metaDescription: 'Learn how Chef IA uses essential, preference, and analytics cookies to operate secure sessions and improve the product on tbuy.store.',
		content: COOKIES_CONTENT,
	}),
	buildTemplate({
		slug: 'disclaimer',
		title: 'Disclaimer',
		description: 'Clarify AI output limits, third-party platform risk, and that Chef IA does not provide professional advice.',
		seoTitle: 'Disclaimer | Chef IA',
		metaDescription: 'Chef IA disclaimer covering AI-generated content, publishing integrations, third-party platforms, and informational use of the Service.',
		content: DISCLAIMER_CONTENT,
	}),
	buildTemplate({
		slug: 'refund',
		title: 'Refund Policy',
		description: 'Cover subscription refunds, credit consumption, billing disputes, and chargeback guidance.',
		seoTitle: 'Refund Policy | Chef IA',
		metaDescription: 'Chef IA refund policy for subscriptions, credits, and billing disputes on tbuy.store.',
		content: REFUND_CONTENT,
	}),
]);

/**
 * Materialize default legal templates with Platform Identity branding.
 * Does not mutate stored user pages — only seed / quick-start template output.
 */
export function getLegalPageTemplates(brand = {}) {
	return LEGAL_PAGE_TEMPLATES.map((item) => ({
		...item,
		description: materializeLegalText(item.description, brand),
		seoTitle: materializeLegalText(item.seoTitle, brand),
		metaDescription: materializeLegalText(item.metaDescription, brand),
		content: materializeLegalText(item.content, brand),
		estimatedReadingMinutes: estimateReadingMinutes(materializeLegalText(item.content, brand)),
	}));
}

export function getLegalPageTemplate(slug, brand = {}) {
	return getLegalPageTemplates(brand).find((item) => item.slug === String(slug || '').toLowerCase()) || null;
}

export function listLegalPageTemplateMeta(brand = {}) {
	return getLegalPageTemplates(brand).map((item) => ({
		slug: item.slug,
		title: item.title,
		description: item.description,
		path: item.path,
		estimatedReadingMinutes: item.estimatedReadingMinutes,
		seoTitle: item.seoTitle,
		metaDescription: item.metaDescription,
		status: item.status,
	}));
}
