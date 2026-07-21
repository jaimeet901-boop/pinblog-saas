const PLAN_CREDITS = {
	free: { ai: 50, image: 20 },
	starter: { ai: 300, image: 100 },
	pro: { ai: 1000, image: 400 },
	agency: { ai: 5000, image: 2000 },
};

export function getPlanCreditLimits(plan) {
	const key = String(plan || 'free').toLowerCase();
	return PLAN_CREDITS[key] || PLAN_CREDITS.free;
}

export async function getUserCreditUsage(pocketbaseClient, userId) {
	const user = await pocketbaseClient.collection('users').getOne(userId).catch(() => null);
	const plan = user?.plan || 'free';
	const limits = getPlanCreditLimits(plan);
	const aiUsed = Number(user?.ai_credits_used || 0);
	const imageUsed = Number(user?.image_credits_used || 0);

	return {
		plan,
		ai: {
			used: aiUsed,
			limit: limits.ai,
			remaining: Math.max(0, limits.ai - aiUsed),
		},
		image: {
			used: imageUsed,
			limit: limits.image,
			remaining: Math.max(0, limits.image - imageUsed),
		},
	};
}

export async function consumeCredits(pocketbaseClient, { userId, ai = 0, image = 0 }) {
	const usage = await getUserCreditUsage(pocketbaseClient, userId);
	if (ai > usage.ai.remaining) {
		const error = new Error(`Insufficient AI credits. Remaining: ${usage.ai.remaining}`);
		error.status = 402;
		throw error;
	}
	if (image > usage.image.remaining) {
		const error = new Error(`Insufficient image credits. Remaining: ${usage.image.remaining}`);
		error.status = 402;
		throw error;
	}

	const user = await pocketbaseClient.collection('users').getOne(userId);
	await pocketbaseClient.collection('users').update(userId, {
		ai_credits_used: Number(user.ai_credits_used || 0) + ai,
		image_credits_used: Number(user.image_credits_used || 0) + image,
	});

	return getUserCreditUsage(pocketbaseClient, userId);
}

export async function recordGenerationHistory(pocketbaseClient, payload) {
	try {
		return await pocketbaseClient.collection('ai_pin_generation_history').create(payload);
	} catch {
		return null;
	}
}
