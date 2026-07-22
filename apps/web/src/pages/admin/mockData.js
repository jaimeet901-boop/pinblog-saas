export const MOCK_STATS = {
	activeUsers: 1284,
	workspaces: 912,
	creditsUsed: 48290,
	aiRequests: 19340,
	revenue: 18420,
	serverHealth: 'Operational',
};

export const MOCK_USERS = [
	{ id: 'u1', name: 'Amina Costa', email: 'amina@example.com', role: 'admin', status: 'active', plan: 'agency', created: '2026-01-12' },
	{ id: 'u2', name: 'Leo Martins', email: 'leo@foodblog.io', role: 'user', status: 'active', plan: 'pro', created: '2026-02-03' },
	{ id: 'u3', name: 'Sofia Reis', email: 'sofia@pins.co', role: 'user', status: 'invited', plan: 'starter', created: '2026-03-18' },
	{ id: 'u4', name: 'Noah Silva', email: 'noah@kitchen.dev', role: 'user', status: 'suspended', plan: 'free', created: '2026-04-01' },
	{ id: 'u5', name: 'Maya Chen', email: 'maya@atelier.ai', role: 'user', status: 'active', plan: 'pro', created: '2026-05-22' },
	{ id: 'u6', name: 'Jules Park', email: 'jules@recipes.app', role: 'user', status: 'active', plan: 'starter', created: '2026-06-09' },
];

export const MOCK_WORKSPACES = [
	{ id: 'w1', name: 'Sunday Kitchen', owner: 'Leo Martins', plan: 'pro', credits: 4200, status: 'active', created: '2026-02-03' },
	{ id: 'w2', name: 'Pin Atelier', owner: 'Sofia Reis', plan: 'starter', credits: 890, status: 'trial', created: '2026-03-18' },
	{ id: 'w3', name: 'Agency North', owner: 'Amina Costa', plan: 'agency', credits: 22000, status: 'active', created: '2026-01-12' },
	{ id: 'w4', name: 'Recipe Lab', owner: 'Maya Chen', plan: 'pro', credits: 3100, status: 'active', created: '2026-05-22' },
];

export const MOCK_PROVIDERS = [
	{ id: 'openai', name: 'OpenAI', status: 'connected', models: 12, latency: '420ms' },
	{ id: 'gemini', name: 'Gemini', status: 'connected', models: 6, latency: '510ms' },
	{ id: 'claude', name: 'Claude', status: 'ready', models: 5, latency: '—' },
	{ id: 'openrouter', name: 'OpenRouter', status: 'ready', models: 40, latency: '—' },
	{ id: 'deepseek', name: 'DeepSeek', status: 'ready', models: 4, latency: '—' },
	{ id: 'grok', name: 'Grok', status: 'ready', models: 3, latency: '—' },
	{ id: 'mistral', name: 'Mistral', status: 'ready', models: 7, latency: '—' },
	{ id: 'replicate', name: 'Replicate', status: 'ready', models: 18, latency: '—' },
	{ id: 'fal', name: 'Fal.ai', status: 'connected', models: 22, latency: '380ms' },
];

export const MOCK_MODELS = [
	{ id: 'm1', provider: 'OpenAI', name: 'gpt-4.1', type: 'text', status: 'enabled' },
	{ id: 'm2', provider: 'OpenAI', name: 'gpt-image-1', type: 'image', status: 'enabled' },
	{ id: 'm3', provider: 'Gemini', name: 'gemini-2.5-pro', type: 'text', status: 'enabled' },
	{ id: 'm4', provider: 'Fal.ai', name: 'flux-pro', type: 'image', status: 'enabled' },
	{ id: 'm5', provider: 'Claude', name: 'claude-sonnet-4', type: 'text', status: 'disabled' },
];

export const MOCK_LOGS = [
	{ id: 'l1', severity: 'info', message: 'Credits ledger synced', source: 'billing', at: '2026-07-22 14:02:11' },
	{ id: 'l2', severity: 'warn', message: 'Pinterest rate limit approaching', source: 'pinterest', at: '2026-07-22 13:48:02' },
	{ id: 'l3', severity: 'error', message: 'Image worker timeout on job #8821', source: 'workers', at: '2026-07-22 13:12:44' },
	{ id: 'l4', severity: 'info', message: 'New workspace created: Recipe Lab', source: 'auth', at: '2026-07-22 12:05:19' },
	{ id: 'l5', severity: 'debug', message: 'Queue drain cycle completed', source: 'queue', at: '2026-07-22 11:59:01' },
];

export const MOCK_QUEUE = {
	running: 7,
	waiting: 23,
	completed: 1482,
	failed: 12,
	retry: 4,
	jobs: [
		{ id: 'j1', name: 'Generate pin pack', status: 'running', workspace: 'Sunday Kitchen', age: '42s' },
		{ id: 'j2', name: 'Publish WordPress draft', status: 'waiting', workspace: 'Pin Atelier', age: '2m' },
		{ id: 'j3', name: 'Optimize prompts', status: 'completed', workspace: 'Agency North', age: '8m' },
		{ id: 'j4', name: 'Fal image render', status: 'failed', workspace: 'Recipe Lab', age: '14m' },
		{ id: 'j5', name: 'Credit top-up webhook', status: 'retry', workspace: 'Agency North', age: '3m' },
	],
};

export const MOCK_HEALTH = [
	{ name: 'API Status', status: 'healthy', detail: '99.98% uptime' },
	{ name: 'Database', status: 'healthy', detail: 'PocketBase primary' },
	{ name: 'Queue', status: 'degraded', detail: '23 waiting jobs' },
	{ name: 'Storage', status: 'healthy', detail: '68% capacity' },
	{ name: 'Workers', status: 'healthy', detail: '4 / 4 online' },
	{ name: 'Email', status: 'healthy', detail: 'SMTP ready' },
	{ name: 'AI Providers', status: 'healthy', detail: '3 connected' },
];

export const MOCK_ACTIVITY = [
	{ id: 'a1', text: 'Maya Chen upgraded to Pro', time: '12m ago' },
	{ id: 'a2', text: 'Fal.ai provider health check passed', time: '28m ago' },
	{ id: 'a3', text: 'Queue retry scheduled for job #8821', time: '41m ago' },
	{ id: 'a4', text: 'New registration: Jules Park', time: '1h ago' },
];

export const MOCK_ALERTS = [
	{ id: 'al1', tone: 'amber', text: 'Pinterest API approaching daily quota' },
	{ id: 'al2', tone: 'red', text: '12 failed image jobs in the last hour' },
	{ id: 'al3', tone: 'green', text: 'Maintenance window cleared' },
];
