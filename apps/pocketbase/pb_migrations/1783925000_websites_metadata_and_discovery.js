/// <reference path="../pb_data/types.d.ts" />

migrate(
	(app) => {
		const websites = app.findCollectionByNameOrId("websites");

		if (!websites.fields.getByName("domain")) {
			websites.fields.add(
				new TextField({
					name: "domain",
					max: 255,
				}),
			);
		}

		if (!websites.fields.getByName("favicon")) {
			websites.fields.add(
				new TextField({
					name: "favicon",
					max: 500,
				}),
			);
		}

		if (!websites.fields.getByName("discovery_status")) {
			websites.fields.add(
				new SelectField({
					name: "discovery_status",
					maxSelect: 1,
					values: ["pending", "ready", "running", "failed"],
				}),
			);
		}

		const statusField = websites.fields.getByName("status");
		if (statusField && Array.isArray(statusField.values) && !statusField.values.includes("active")) {
			statusField.values.push("active");
		}

		app.save(websites);
	},
	(app) => {
		const websites = app.findCollectionByNameOrId("websites");

		try { websites.fields.removeByName("domain"); } catch (_) {}
		try { websites.fields.removeByName("favicon"); } catch (_) {}
		try { websites.fields.removeByName("discovery_status"); } catch (_) {}

		const statusField = websites.fields.getByName("status");
		if (statusField && Array.isArray(statusField.values)) {
			statusField.values = statusField.values.filter((value) => value !== "active");
		}

		app.save(websites);
	},
);
