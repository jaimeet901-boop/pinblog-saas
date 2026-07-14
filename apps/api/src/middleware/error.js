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
