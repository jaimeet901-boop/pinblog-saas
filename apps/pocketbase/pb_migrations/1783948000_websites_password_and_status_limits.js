/// <reference path="../pb_data/types.d.ts" />

migrate(
	(app) => {
		const websites = app.findCollectionByNameOrId("websites");
		const passwordField = websites.fields.getByName("wp_app_password");

		// Encrypted app passwords (enc:v1:...) exceed the original 200-char limit.
		if (passwordField) {
			passwordField.max = 2000;
		}

		const urlField = websites.fields.getByName("url");
		if (urlField && urlField.type === "url") {
			// Keep as URL type but ensure required for scan reliability when possible.
			urlField.required = true;
		}

		const statusField = websites.fields.getByName("status");
		if (statusField && Array.isArray(statusField.values)) {
			for (const value of ["active", "untested", "connected", "failed"]) {
				if (!statusField.values.includes(value)) {
					statusField.values.push(value);
				}
			}
		}

		app.save(websites);
	},
	(app) => {
		const websites = app.findCollectionByNameOrId("websites");
		const passwordField = websites.fields.getByName("wp_app_password");

		if (passwordField) {
			passwordField.max = 200;
		}

		const urlField = websites.fields.getByName("url");
		if (urlField) {
			urlField.required = false;
		}

		app.save(websites);
	},
);
