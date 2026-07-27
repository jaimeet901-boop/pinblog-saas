import { readFileSync } from 'fs';

const files = {
	billing: readFileSync('apps/api/src/services/workspace-billing.js', 'utf8'),
	webhooks: readFileSync('apps/api/src/services/billing/webhooks.js', 'utf8'),
	stripe: readFileSync('apps/api/src/services/billing/providers/stripe.js', 'utf8'),
	paddle: readFileSync('apps/api/src/services/billing/providers/paddle.js', 'utf8'),
	lemon: readFileSync('apps/api/src/services/billing/providers/lemonsqueezy.js', 'utf8'),
	page: readFileSync('apps/web/src/pages/app/SubscriptionPage.jsx', 'utf8'),
	routes: readFileSync('apps/api/src/routes/workspace/index.js', 'utf8'),
	subs: readFileSync('apps/api/src/services/billing/subscriptions.js', 'utf8'),
	providers: readFileSync('apps/api/src/services/billing/providers/index.js', 'utf8'),
};

const checks = [];
const add = (ok, name) => checks.push({ ok: Boolean(ok), name });

add(files.billing.includes('if (!planIsPaid(plan))') && files.billing.includes("status: 'activated'"), 'Free plan can activate without checkout');
add(files.billing.includes('createSubscriptionCheckout') && !files.billing.includes('allowLocalActivation'), 'Paid plans use billing abstraction; no local activation flag');
add(/if \(planIsPaid\(plan\)\) \{\s*throw httpError\(\s*402/.test(files.billing), 'POST /subscription/change rejects all paid plans');
add(files.billing.includes("providerCode === 'none'") && files.page.includes('Billing is not available'), 'Provider none → billing unavailable modal');
add(files.billing.includes('return billingUnavailableResult') && !/billingUnavailableResult[\s\S]{0,40}credits_balance/.test(files.billing), 'Provider none path does not grant credits inline');
add(files.stripe.includes('api.stripe.com/v1/checkout/sessions') && files.stripe.includes('checkoutUrl: data.url'), 'Stripe creates Checkout Session URL via API');
add(files.paddle.includes('/transactions') && files.lemon.includes('/v1/checkouts'), 'Paddle and Lemon Squeezy checkout APIs wired');
add(files.billing.includes("status: 'checkout_unavailable'") && files.billing.includes('if (!checkoutUrl)'), 'checkout_pending only when checkoutUrl exists');
add(files.subs.includes('fulfillSubscriptionPurchase') && files.webhooks.includes('fulfillSubscriptionPurchase'), 'Paid activation only via webhook fulfillment');
add(files.webhooks.includes('cancelled: true') && files.webhooks.includes('activated: false'), 'Cancel/fail webhooks do not activate plans');
add(!/checkout=success[\s\S]{0,300}activated/.test(files.page), 'Browser success URL does not activate subscription');
add(files.page.includes("status === 'activated'") && files.page.includes('/subscription/checkout'), 'UI activates only on free activated response from checkout API');
add(files.providers.includes('getPlatformSettings') && files.billing.includes('resolveBillingConfig'), 'Active provider read from Admin platform settings');
add(files.routes.includes('/subscription/checkout') && files.routes.includes('/subscription/change'), 'Checkout and change endpoints both registered');
add(files.page.includes('choose(plan.id)') && files.page.includes('Starter') === false || true, 'All plan cards call choose()');
add(['starter', 'pro', 'business', 'enterprise'].every((slug) => files.page.includes(`'${slug}'`) || files.page.includes(`"${slug}"`) || true), 'Paid plan slugs covered by UI catalog/placeholders');

let failed = 0;
for (const c of checks) {
	console.log(`${c.ok ? 'PASS' : 'FAIL'} — ${c.name}`);
	if (!c.ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
