import initSqlJs from 'sql.js';
import fs from 'node:fs';

async function inspect(label, dbPath) {
	if (!fs.existsSync(dbPath)) return { label, missing: true };
	const SQL = await initSqlJs();
	const db = new SQL.Database(fs.readFileSync(dbPath));
	const q = (sql) => {
		const res = db.exec(sql);
		if (!res[0]) return [];
		const cols = res[0].columns;
		return res[0].values.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
	};
	const cols = q('PRAGMA table_info(ai_pin_templates)').map((c) => c.name);
	return {
		label,
		cols,
		hasVisibility: cols.includes('visibility'),
		hasUuid: cols.includes('template_uuid'),
		count: q('SELECT COUNT(*) AS c FROM ai_pin_templates')[0]?.c ?? 0,
		users: q('SELECT COUNT(*) AS c FROM users')[0]?.c ?? 0,
	};
}

const reports = [];
for (const p of [
	'apps/pocketbase/pb_data/data.db',
	'apps/pocketbase/pb_data_release_fresh/data.db',
	'apps/pocketbase/pb_data_release_upgrade/data.db',
	'apps/pocketbase/pb_data_m1_test/data.db',
]) {
	reports.push(await inspect(p, p));
}
console.log(JSON.stringify(reports, null, 2));
fs.writeFileSync('docs/qa-evidence/official-templates/db-schema-compare.json', JSON.stringify(reports, null, 2));
