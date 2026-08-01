/// <reference path="../pb_data/types.d.ts" />

/**
 * Mail delivery for PocketBase transactional email (password reset, verification, etc.).
 *
 * Priority:
 * 1. Native PocketBase SMTP when settings.smtp.enabled
 * 2. Builder Mailer HTTP API when BUILDER_MAILER_* env vars are set
 *
 * Always logs success/failure. Writes last status to pb_data/mailer-status.json
 * for Admin Mail diagnostics (do not rely on HTTP 204 from request-password-reset).
 */

function mailerStatusPath() {
	return $filepath.join(__hooks, "../pb_data/mailer-status.json");
}

function writeMailerStatus(payload) {
	try {
		const body = JSON.stringify({
			...payload,
			updatedAt: new Date().toISOString(),
		}, null, 2);
		$os.writeFile(mailerStatusPath(), body, 0o644);
	} catch (err) {
		$app.logger().error("[mailer] failed to write status file", "error", String(err));
	}
}

function recipientAddress(message) {
	try {
		return String(message?.to?.[0]?.address || "");
	} catch (_) {
		return "";
	}
}

onMailerSend((e) => {
	const to = recipientAddress(e.message);
	const subject = String(e.message?.subject || "");

	try {
		if (e.app.settings().smtp.enabled) {
			try {
				e.next();
				$app.logger().info("[mailer] sent via pocketbase smtp", "to", to, "subject", subject);
				writeMailerStatus({
					ok: true,
					path: "pocketbase_smtp",
					to,
					subject,
					lastError: null,
				});
			} catch (smtpErr) {
				const msg = String(smtpErr?.message || smtpErr || "SMTP send failed");
				$app.logger().error("[mailer] smtp send failed", "to", to, "subject", subject, "error", msg);
				writeMailerStatus({
					ok: false,
					path: "pocketbase_smtp",
					to,
					subject,
					lastError: { at: new Date().toISOString(), source: "smtp", message: msg },
				});
				throw smtpErr;
			}
			return;
		}

		const apiUrl = String($os.getenv("BUILDER_MAILER_API_URL") || "").trim();
		const apiKey = String($os.getenv("BUILDER_MAILER_API_KEY") || "").trim();
		const senderAddress = String($os.getenv("BUILDER_MAILER_SENDER_ADDRESS") || "").trim();

		if (!apiUrl || !apiKey || !senderAddress) {
			const msg = "Mail delivery is not configured. Enable PocketBase SMTP or set BUILDER_MAILER_API_URL, BUILDER_MAILER_API_KEY, and BUILDER_MAILER_SENDER_ADDRESS.";
			$app.logger().error(
				"[mailer] no delivery path",
				"smtpEnabled", false,
				"builderConfigured", false,
				"to", to,
				"subject", subject,
			);
			writeMailerStatus({
				ok: false,
				path: "none",
				to,
				subject,
				lastError: { at: new Date().toISOString(), source: "config", message: msg },
			});
			throw new ApiError(500, msg);
		}

		const payload = {
			subject: e.message.subject,
			content: {
				...(e.message.html ? { html: e.message.html } : { text: e.message.text }),
				type: "plain",
			},
			from: senderAddress,
			fromName: e.message.from?.name,
			replyTo: senderAddress,
			to,
		};

		const response = $http.send({
			url: `${apiUrl}/api/v2/email`,
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});

		if (response.statusCode !== 200) {
			const errBody = response.json || response.raw || {};
			const msg = errBody?.message || "Failed to send email via Builder Mailer";
			$app.logger().error(
				"[mailer] builder send failed",
				"to", to,
				"subject", subject,
				"statusCode", response.statusCode,
				"error", errBody,
			);
			writeMailerStatus({
				ok: false,
				path: "builder_mailer",
				to,
				subject,
				lastError: {
					at: new Date().toISOString(),
					source: "builder_mailer",
					message: msg,
					statusCode: response.statusCode,
					detail: errBody,
				},
			});
			throw new ApiError(500, msg);
		}

		$app.logger().info("[mailer] sent via builder mailer", "to", to, "subject", subject);
		writeMailerStatus({
			ok: true,
			path: "builder_mailer",
			to,
			subject,
			lastError: null,
		});
	} catch (err) {
		// Ensure unexpected errors are also logged (re-throw for PocketBase).
		if (!String(err?.message || "").includes("Mail delivery is not configured")
			&& !String(err?.message || "").includes("Failed to send email")) {
			$app.logger().error("[mailer] send failed", "to", to, "subject", subject, "error", String(err));
		}
		throw err;
	}
});
