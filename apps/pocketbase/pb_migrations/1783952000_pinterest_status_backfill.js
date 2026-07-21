/// <reference path="../pb_data/types.d.ts" />

migrate(
	(app) => {
		// Backfill missing status for legacy connected accounts so multi-account
		// filters and assertPinterestConnected treat them as connected.
		try {
			const records = app.findRecordsByFilter("pinterest_accounts", "id != ''", "-created", 2000, 0);
			for (const record of records) {
				const status = String(record.get("status") || "").trim();
				const connected = record.get("connected") === true;
				if (!status && connected) {
					record.set("status", "connected");
					app.save(record);
				}
			}
		} catch (_) {
			// Best-effort only.
		}
	},
	(_app) => {
		// No-op down migration: status values are intentional operational data.
	},
);
