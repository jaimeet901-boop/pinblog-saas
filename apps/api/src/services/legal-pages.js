import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { writeAuditLog } from './audit/write.js';

export const LEGAL_PAGE_SLUGS = Object.freeze([
	'privacy',
	'terms',
	'cookies',
	'disclaimer',
	'refund',
]);

const SITE_URL = 'https://tbuy.store';
const PRIVACY_EMAIL = 'privacy@tbuy.store';
const SUPPORT_EMAIL = 'support@tbuy.store';

function normalizeSlug(value) {
	return String(value || '').trim().toLowerCase();
}

function assertSlug(slug) {
	const normalized = normalizeSlug(slug);
	if (!LEGAL_PAGE_SLUGS.includes(normalized)) {
		throw httpError(422, `Invalid legal page slug. Allowed: ${LEGAL_PAGE_SLUGS.join(', ')}`, 'VALIDATION_ERROR');
	}
	return normalized;
}

function normalizeStatus(value, fallback = 'draft') {
	const status = String(value || fallback).trim().toLowerCase();
	if (status !== 'draft' && status !== 'published') {
		throw httpError(422, 'Status must be draft or published.', 'VALIDATION_ERROR');
	}
	return status;
}

function clip(value, max) {
	return String(value || '').trim().slice(0, max);
}

function actorLabel(adminUser) {
	if (!adminUser) return 'admin';
	return String(adminUser.email || adminUser.name || adminUser.id || 'admin').slice(0, 200);
}

export function mapLegalPage(record) {
	if (!record) return null;
	return {
		id: record.id,
		slug: record.slug,
		title: record.title || '',
		seoTitle: record.seo_title || record.title || '',
		metaDescription: record.meta_description || '',
		content: record.content || '',
		status: record.status || 'draft',
		version: Number(record.version) || 1,
		updatedBy: record.updated_by || '',
		createdAt: record.created || '',
		updatedAt: record.updated || '',
		canonicalPath: `/${record.slug}`,
		canonicalUrl: `${SITE_URL}/${record.slug}`,
	};
}

export function mapLegalPageVersion(record) {
	if (!record) return null;
	return {
		id: record.id,
		pageId: record.page || '',
		slug: record.slug,
		version: Number(record.version) || 1,
		title: record.title || '',
		seoTitle: record.seo_title || '',
		metaDescription: record.meta_description || '',
		content: record.content || '',
		status: record.status || 'draft',
		updatedBy: record.updated_by || '',
		snapshotAt: record.snapshot_at || record.created || '',
		createdAt: record.created || '',
	};
}

function defaultPages() {
	const privacyContent = `# Privacy Policy

**Last updated:** July 26, 2026

This Privacy Policy explains how Chef IA ("Chef IA," "we," "us," or "our") collects, uses, shares, and protects personal information when you use our website and services at ${SITE_URL} and related applications.

## 1. Introduction

Chef IA is an AI-assisted content and publishing platform that helps creators write SEO-ready articles, generate images and Pinterest pins, manage brand kits and templates, and publish to connected websites, WordPress sites, and Pinterest accounts.

By creating an account, connecting third-party services, or otherwise using Chef IA, you acknowledge that your information will be handled as described in this Privacy Policy.

## 2. Information we collect

### Account and profile information
- Name, email address, and password (or credentials created through supported sign-in methods)
- Workspace name, profile preferences, plan selection, and billing-related account status
- Communications you send to us, including support requests and feedback

### Usage and technical information
- Log data such as IP address, browser type, device information, approximate location derived from IP, pages viewed, and timestamps
- Diagnostic events related to authentication, publishing jobs, queue processing, and error reports

### Content and operational data
- Articles, prompts, pin titles and descriptions, templates, brand kits, images, schedules, and publishing history
- Website, WordPress, and Pinterest connection metadata required to perform the features you enable

We do not sell your personal information.

## 3. Authentication

Chef IA authenticates users through secure account credentials. Passwords are stored using industry-standard hashing practices. Access tokens for connected services are stored encrypted at rest where applicable.

## 4. Workspace data

Workspace data may include settings, connected sites and accounts, content drafts, generation history, publishing queues, calendars, analytics summaries, and credit or subscription usage. Workspace data is accessible to authorized users of that workspace and to Chef IA personnel solely as needed to provide support, maintain the platform, investigate abuse, or meet legal obligations.

## 5. Website connections

When you add a website, we may store the site URL, display name, discovery settings, article metadata, and destination links used for pin publishing.

## 6. WordPress integration

If you connect WordPress, Chef IA stores connection details required to authenticate and publish on your behalf. Credentials are used only to create, update, or manage content you choose to publish.

## 7. Pinterest OAuth

When you connect Pinterest, Chef IA uses Pinterest’s OAuth 2.0 flow. Tokens are used to create and manage pins, sync boards, and retrieve publishing status for your connected accounts. You may disconnect Pinterest at any time.

## 8. AI providers

Chef IA uses third-party AI providers such as OpenAI, Google Gemini, Fal.ai, and other models enabled by the Admin Console. Prompts and related inputs may be transmitted to the selected provider to fulfill your request.

## 9. Cookies

Chef IA uses essential cookies for authentication and security, preference cookies for interface settings, and analytics cookies where enabled to improve reliability.

## 10. Analytics

Chef IA provides in-product analytics for your workspace and collects operational metrics to monitor platform performance and prevent abuse.

## 11. Data retention

We retain personal information and workspace data for as long as your account remains active and as needed to provide the Service, with limited additional retention for security, backups, and legal compliance.

## 12. Your rights

Depending on your location, you may have rights to access, correct, export, restrict, or delete personal information. Contact ${PRIVACY_EMAIL} to exercise these rights.

## 13. Security

We implement administrative, technical, and organizational measures designed to protect personal information, including HTTPS, access controls, and encrypted storage of sensitive credentials where applicable.

## 14. Contact

- Privacy inquiries: ${PRIVACY_EMAIL}
- Product support: ${SUPPORT_EMAIL}
- Website: ${SITE_URL}
`;

	return [
		{
			slug: 'privacy',
			title: 'Privacy Policy',
			seo_title: 'Privacy Policy | Chef IA',
			meta_description: 'Learn how Chef IA collects, uses, and protects your account, workspace, website, WordPress, Pinterest, and AI-related data on tbuy.store.',
			content: privacyContent,
			status: 'published',
		},
		{
			slug: 'terms',
			title: 'Terms of Service',
			seo_title: 'Terms of Service | Chef IA',
			meta_description: 'Read the Chef IA Terms of Service governing account use, workspaces, publishing integrations, AI features, and acceptable use on tbuy.store.',
			content: `# Terms of Service

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
`,
			status: 'published',
		},
		{
			slug: 'cookies',
			title: 'Cookie Policy',
			seo_title: 'Cookie Policy | Chef IA',
			meta_description: 'Learn how Chef IA uses essential, preference, and analytics cookies to operate secure sessions and improve the product on tbuy.store.',
			content: `# Cookie Policy

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
`,
			status: 'published',
		},
		{
			slug: 'disclaimer',
			title: 'Disclaimer',
			seo_title: 'Disclaimer | Chef IA',
			meta_description: 'Chef IA disclaimer covering AI-generated content, publishing integrations, third-party platforms, and informational use of the Service.',
			content: `# Disclaimer

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
`,
			status: 'published',
		},
		{
			slug: 'refund',
			title: 'Refund Policy',
			seo_title: 'Refund Policy | Chef IA',
			meta_description: 'Chef IA refund policy for subscriptions, credits, and billing disputes on tbuy.store.',
			content: `# Refund Policy

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
`,
			status: 'published',
		},
	];
}

async function getBySlugRecord(slug) {
	const normalized = assertSlug(slug);
	return pocketbaseClient.collection('legal_pages').getFirstListItem(
		pocketbaseClient.filter('slug = {:slug}', { slug: normalized }),
		{ requestKey: null },
	).catch(() => null);
}

async function snapshotVersion(page, adminUser) {
	const now = new Date().toISOString();
	return pocketbaseClient.collection('legal_page_versions').create({
		page: page.id,
		slug: page.slug,
		version: Number(page.version) || 1,
		title: page.title || '',
		seo_title: page.seo_title || '',
		meta_description: page.meta_description || '',
		content: page.content || '',
		status: page.status || 'draft',
		updated_by: page.updated_by || actorLabel(adminUser),
		snapshot_at: now,
	}, { requestKey: null });
}

export async function ensureDefaultLegalPages(adminUser = null) {
	const defaults = defaultPages();
	const created = [];
	for (const item of defaults) {
		const existing = await getBySlugRecord(item.slug);
		if (existing) continue;
		const record = await pocketbaseClient.collection('legal_pages').create({
			slug: item.slug,
			title: item.title,
			seo_title: item.seo_title,
			meta_description: item.meta_description,
			content: item.content,
			status: item.status,
			version: 1,
			updated_by: actorLabel(adminUser) || 'system',
		}, { requestKey: null });
		await snapshotVersion(record, adminUser).catch(() => null);
		created.push(mapLegalPage(record));
	}
	return created;
}

export async function listLegalPages({ q = '' } = {}) {
	await ensureDefaultLegalPages();
	const rows = await pocketbaseClient.collection('legal_pages').getFullList({
		sort: 'slug',
		requestKey: null,
	}).catch(() => []);
	const query = String(q || '').trim().toLowerCase();
	const mapped = rows.map(mapLegalPage);
	if (!query) return { items: mapped, total: mapped.length };
	const filtered = mapped.filter((item) => (
		item.slug.includes(query)
		|| item.title.toLowerCase().includes(query)
		|| item.seoTitle.toLowerCase().includes(query)
		|| item.status.includes(query)
	));
	return { items: filtered, total: filtered.length };
}

export async function getLegalPageBySlug(slug) {
	await ensureDefaultLegalPages();
	const record = await getBySlugRecord(slug);
	if (!record) {
		throw httpError(404, 'Legal page not found.', 'LEGAL_PAGE_NOT_FOUND');
	}
	return mapLegalPage(record);
}

export async function getPublishedLegalPageBySlug(slug) {
	await ensureDefaultLegalPages();
	const record = await getBySlugRecord(slug);
	if (!record || record.status !== 'published') {
		throw httpError(404, 'Legal page not found.', 'LEGAL_PAGE_NOT_FOUND');
	}
	return mapLegalPage(record);
}

export async function createLegalPage(body = {}, adminUser = null) {
	const slug = assertSlug(body.slug);
	const existing = await getBySlugRecord(slug);
	if (existing) {
		throw httpError(409, `Legal page "${slug}" already exists.`, 'LEGAL_PAGE_EXISTS');
	}

	const title = clip(body.title, 300);
	if (!title) {
		throw httpError(422, 'Title is required.', 'VALIDATION_ERROR');
	}
	const content = String(body.content || '').trim();
	if (!content) {
		throw httpError(422, 'Content is required.', 'VALIDATION_ERROR');
	}

	const record = await pocketbaseClient.collection('legal_pages').create({
		slug,
		title,
		seo_title: clip(body.seoTitle ?? body.seo_title ?? title, 300),
		meta_description: clip(body.metaDescription ?? body.meta_description ?? '', 600),
		content,
		status: normalizeStatus(body.status, 'draft'),
		version: 1,
		updated_by: actorLabel(adminUser),
	}, { requestKey: null });

	await snapshotVersion(record, adminUser).catch(() => null);
	await writeAuditLog({
		category: 'admin',
		action: 'legal_page_created',
		message: `Created legal page ${slug}`,
		actorUserId: adminUser?.id,
		actorLabel: actorLabel(adminUser),
		service: 'LegalPages',
		metadata: { slug, version: 1 },
	}).catch(() => null);

	return mapLegalPage(record);
}

export async function updateLegalPage(slug, body = {}, adminUser = null) {
	const record = await getBySlugRecord(slug);
	if (!record) {
		throw httpError(404, 'Legal page not found.', 'LEGAL_PAGE_NOT_FOUND');
	}

	const title = body.title != null ? clip(body.title, 300) : record.title;
	if (!title) {
		throw httpError(422, 'Title is required.', 'VALIDATION_ERROR');
	}
	const content = body.content != null ? String(body.content).trim() : record.content;
	if (!content) {
		throw httpError(422, 'Content is required.', 'VALIDATION_ERROR');
	}

	const nextVersion = (Number(record.version) || 1) + 1;
	const payload = {
		title,
		seo_title: body.seoTitle != null || body.seo_title != null
			? clip(body.seoTitle ?? body.seo_title, 300)
			: (record.seo_title || title),
		meta_description: body.metaDescription != null || body.meta_description != null
			? clip(body.metaDescription ?? body.meta_description, 600)
			: (record.meta_description || ''),
		content,
		status: body.status != null ? normalizeStatus(body.status, record.status) : record.status,
		version: nextVersion,
		updated_by: actorLabel(adminUser),
	};

	const updated = await pocketbaseClient.collection('legal_pages').update(record.id, payload, { requestKey: null });
	await snapshotVersion(updated, adminUser).catch(() => null);
	await writeAuditLog({
		category: 'admin',
		action: 'legal_page_updated',
		message: `Updated legal page ${updated.slug} to v${nextVersion}`,
		actorUserId: adminUser?.id,
		actorLabel: actorLabel(adminUser),
		service: 'LegalPages',
		metadata: { slug: updated.slug, version: nextVersion, status: updated.status },
	}).catch(() => null);

	return mapLegalPage(updated);
}

export async function deleteLegalPage(slug, adminUser = null) {
	const record = await getBySlugRecord(slug);
	if (!record) {
		throw httpError(404, 'Legal page not found.', 'LEGAL_PAGE_NOT_FOUND');
	}
	await pocketbaseClient.collection('legal_pages').delete(record.id, { requestKey: null });
	await writeAuditLog({
		category: 'admin',
		action: 'legal_page_deleted',
		message: `Deleted legal page ${record.slug}`,
		actorUserId: adminUser?.id,
		actorLabel: actorLabel(adminUser),
		service: 'LegalPages',
		metadata: { slug: record.slug, version: record.version },
	}).catch(() => null);
	return { ok: true, slug: record.slug };
}

export async function listLegalPageVersions(slug) {
	assertSlug(slug);
	const rows = await pocketbaseClient.collection('legal_page_versions').getFullList({
		filter: pocketbaseClient.filter('slug = {:slug}', { slug: normalizeSlug(slug) }),
		sort: '-version',
		requestKey: null,
	}).catch(() => []);
	return { items: rows.map(mapLegalPageVersion), total: rows.length };
}

export async function restoreLegalPageVersion(slug, version, adminUser = null) {
	const normalized = assertSlug(slug);
	const versionNumber = Number(version);
	if (!Number.isFinite(versionNumber) || versionNumber < 1) {
		throw httpError(422, 'Valid version number is required.', 'VALIDATION_ERROR');
	}

	const snapshot = await pocketbaseClient.collection('legal_page_versions').getFirstListItem(
		pocketbaseClient.filter('slug = {:slug} && version = {:version}', {
			slug: normalized,
			version: versionNumber,
		}),
		{ requestKey: null },
	).catch(() => null);

	if (!snapshot) {
		throw httpError(404, 'Version not found.', 'LEGAL_PAGE_VERSION_NOT_FOUND');
	}

	return updateLegalPage(normalized, {
		title: snapshot.title,
		seoTitle: snapshot.seo_title,
		metaDescription: snapshot.meta_description,
		content: snapshot.content,
		status: snapshot.status,
	}, adminUser);
}
