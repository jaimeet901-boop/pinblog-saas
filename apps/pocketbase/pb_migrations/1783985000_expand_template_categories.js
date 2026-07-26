/// <reference path="../pb_data/types.d.ts" />
/**
 * Expand ai_pin_templates.category select values for Chef IA official library.
 */

const TEMPLATE_CATEGORIES = [
	"recipes",
	"dinner",
	"breakfast",
	"desserts",
	"snacks",
	"drinks",
	"healthy",
	"lifestyle",
	"home",
	"fitness",
	"travel",
	"finance",
	"technology",
	"diy",
	"general",
];

migrate(
	(app) => {
		const templates = app.findCollectionByNameOrId("ai_pin_templates");
		if (!templates) return;
		const field = templates.fields.getByName("category");
		if (!field) return;
		field.values = TEMPLATE_CATEGORIES;
		app.save(templates);
	},
	(app) => {
		const templates = app.findCollectionByNameOrId("ai_pin_templates");
		if (!templates) return;
		const field = templates.fields.getByName("category");
		if (!field) return;
		field.values = [
			"recipes",
			"desserts",
			"fitness",
			"travel",
			"finance",
			"technology",
			"diy",
			"general",
		];
		app.save(templates);
	},
);
