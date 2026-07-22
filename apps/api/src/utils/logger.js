import { writeSystemLog } from '../services/audit/write.js';

let writing = false;

function persist(level, args) {
	if (writing) return;
	const message = args.map((arg) => {
		if (arg instanceof Error) return arg.message;
		if (typeof arg === 'string') return arg;
		try {
			return JSON.stringify(arg);
		} catch {
			return String(arg);
		}
	}).join(' ').slice(0, 2000);

	writing = true;
	writeSystemLog({
		level,
		source: 'api-logger',
		message,
	}).finally(() => {
		writing = false;
	});
}

const logger = {
	error: (...args) => {
		console.log('[ERROR]', ...args);
		persist('error', args);
	},
	fatal: (...args) => {
		console.error('[FATAL]', ...args);
		persist('critical', args);
	},
	info: (...args) => {
		console.log('[INFO]', ...args);
	},
	debug: (...args) => {
		console.log('[DEBUG]', ...args);
	},
	warn: (...args) => {
		console.log('[WARN]', ...args);
		persist('warn', args);
	},
};

export default logger;
export { logger };
