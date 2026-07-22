import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import { MOCK_PROVIDERS } from '@/pages/admin/mockData';

export default function AdminProvidersPage() {
	return (
		<div>
			<AdminHero
				title="AI Providers"
				description="Prepare management UI for OpenAI, Gemini, Claude, OpenRouter, DeepSeek, Grok, Mistral, Replicate, and Fal.ai."
			/>
			<div className="admin-provider-grid">
				{MOCK_PROVIDERS.map((provider) => (
					<article key={provider.id} className="admin-provider">
						<div className="flex items-start justify-between gap-2">
							<h4>{provider.name}</h4>
							<StatusPill status={provider.status} />
						</div>
						<p>{provider.models} models · latency {provider.latency}</p>
						<div className="mt-3 flex flex-wrap gap-2">
							<button type="button" className="admin-btn admin-btn--primary" disabled>Configure</button>
							<button type="button" className="admin-btn" disabled>Test</button>
						</div>
					</article>
				))}
			</div>
			<p className="admin-note">Keys and provider auth remain admin-owned elsewhere — this screen has no backend wiring.</p>
		</div>
	);
}
