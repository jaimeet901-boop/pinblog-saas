/**
 * Shared Facebook publish validation error mapping for routes and services.
 */

export function throwForFacebookPublishValidation(result = {}) {
	if (result.ok) return;

	const errors = Array.isArray(result.errors) ? result.errors : [];
	const message = errors[0] || 'Facebook publish validation failed';

	if (errors.some((item) => /AI pin is required/i.test(item))) {
		throw publishValidationError(422, message, 'FACEBOOK_AI_PIN_REQUIRED');
	}
	if (errors.some((item) => /AI pin not found/i.test(item))) {
		throw publishValidationError(404, message, 'FACEBOOK_AI_PIN_NOT_FOUND');
	}
	if (errors.some((item) => /active Facebook publish job/i.test(item))) {
		throw publishValidationError(409, message, 'FACEBOOK_PUBLISH_JOB_CONFLICT');
	}
	if (errors.some((item) => /Facebook account not found/i.test(item))) {
		throw publishValidationError(404, message, 'FACEBOOK_ACCOUNT_NOT_FOUND');
	}
	if (errors.some((item) => /Facebook destination not found/i.test(item))) {
		throw publishValidationError(404, message, 'FACEBOOK_DESTINATION_NOT_FOUND');
	}
	throw publishValidationError(422, message, 'FACEBOOK_VALIDATION_FAILED');
}

function publishValidationError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}
