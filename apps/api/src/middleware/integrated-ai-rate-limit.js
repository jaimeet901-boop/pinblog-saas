import rateLimit from 'express-rate-limit';

export const integratedAiRateLimit = rateLimit({
	windowMs: 60 * 1000,
	max: 10,
	standardHeaders: true,
	legacyHeaders: false,
	message: { error: 'Too many AI requests, please try again later' },
	validate: { trustProxy: false },
});
