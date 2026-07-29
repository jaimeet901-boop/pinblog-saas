import logger from '../utils/logger.js';
import { NodeEnv } from '../constants/common.js';

const errorMiddleware = (err, req, res, next) => {
	logger.error(err.message, err.stack);

	if (res.headersSent) {
		return next(err);
	}

	const status = Number.isInteger(err.status) ? err.status : 500;
	const rawMessage = typeof err.message === 'string' && err.message.trim()
		? err.message
		: 'Something went wrong!';
	const message = process.env.NODE_ENV === NodeEnv.Production && status >= 500
		? 'Internal server error'
		: rawMessage;

	res.status(status).json({
		message,
		errorCode: err.errorCode || (status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 400 || status === 422 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'),
		...(err.access && typeof err.access === 'object' ? { access: err.access } : {}),
		...(Array.isArray(err.missingKeys) ? { missingKeys: err.missingKeys } : {}),
		...(Array.isArray(err.dependencyChain) ? { dependencyChain: err.dependencyChain } : {}),
		...(err.featureKey ? { featureKey: err.featureKey } : {}),
		...(Array.isArray(err.requiredKeys) ? { requiredKeys: err.requiredKeys } : {}),
		...(err.details && typeof err.details === 'object' ? { details: err.details } : {}),
		...(process.env.NODE_ENV !== NodeEnv.Production && {
			error: {
				status,
				name: err.name,
				message: err.message,
				stack: err.stack,
			},
		}),
	});
};

export default errorMiddleware;
export { errorMiddleware };
