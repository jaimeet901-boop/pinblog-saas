/// <reference path="../pb_data/types.d.ts" />

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId("users");
		// Allow a signed-in admin to list/view all users; otherwise only self.
		users.listRule = "id = @request.auth.id || @request.auth.role = 'admin'";
		users.viewRule = "id = @request.auth.id || @request.auth.role = 'admin'";
		app.save(users);

		// Optional bootstrap admin from environment variables.
		const email = $os.getenv("PB_INITIAL_ADMIN_EMAIL");
		const password = $os.getenv("PB_INITIAL_ADMIN_PASSWORD");

		if (!email || !password) {
			return;
		}

		try {
			app.findAuthRecordByEmail("users", email);
		} catch (_) {
			const admin = new Record(users);
			admin.setEmail(email);
			admin.setPassword(password);
			admin.set("name", "Chef Admin");
			admin.set("plan", "agency");
			admin.set("role", "admin");
			admin.set("verified", true);
			app.save(admin);
		}
	},
	(app) => {
		const users = app.findCollectionByNameOrId("users");
		users.listRule = "id = @request.auth.id";
		users.viewRule = "id = @request.auth.id";
		app.save(users);
	},
);
