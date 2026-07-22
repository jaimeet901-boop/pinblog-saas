import { AdminHero } from '@/components/admin/AdminUi';

const SECTIONS = [
	{
		title: 'Branding',
		fields: [
			{ label: 'Product name', value: 'Chef IA' },
			{ label: 'Support email', value: 'support@chef-ia.example' },
		],
	},
	{
		title: 'Platform',
		fields: [
			{ label: 'Default plan', value: 'free' },
			{ label: 'Signup mode', value: 'open' },
		],
	},
	{
		title: 'Emails',
		fields: [
			{ label: 'From name', value: 'Chef IA' },
			{ label: 'SMTP host', value: 'smtp.placeholder.local' },
		],
	},
	{
		title: 'Storage',
		fields: [
			{ label: 'Provider', value: 'local / S3 placeholder' },
			{ label: 'Bucket', value: 'chef-ia-assets' },
		],
	},
	{
		title: 'Security',
		fields: [
			{ label: 'Session TTL', value: '7 days' },
			{ label: 'Require verified email', value: 'true' },
		],
	},
	{
		title: 'Maintenance Mode',
		fields: [
			{ label: 'Enabled', value: 'false' },
			{ label: 'Message', value: 'We will be back shortly.' },
		],
	},
];

export default function AdminSettingsPage() {
	return (
		<div>
			<AdminHero
				title="Global Settings"
				description="Branding, platform, emails, storage, security, and maintenance mode. No backend persistence."
			/>
			<div className="admin-settings-grid">
				{SECTIONS.map((section) => (
					<section key={section.title} className="admin-card">
						<h3>{section.title}</h3>
						{section.fields.map((field) => (
							<div key={field.label} className="admin-field">
								<label>{field.label}</label>
								<input defaultValue={field.value} disabled />
							</div>
						))}
						<button type="button" className="admin-btn" disabled>Save (coming soon)</button>
					</section>
				))}
			</div>
		</div>
	);
}
