import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import { MOCK_MODELS } from '@/pages/admin/mockData';

export default function AdminModelsPage() {
	return (
		<div>
			<AdminHero
				title="AI Models"
				description="Catalog of text and image models available to the platform. Mock rows only."
			/>
			<section className="admin-card">
				<div className="admin-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>Provider</th>
								<th>Model</th>
								<th>Type</th>
								<th>Status</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{MOCK_MODELS.map((model) => (
								<tr key={model.id}>
									<td>{model.provider}</td>
									<td className="font-medium">{model.name}</td>
									<td><StatusPill status={model.type} /></td>
									<td><StatusPill status={model.status} /></td>
									<td><button type="button" className="admin-btn" disabled>Toggle</button></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
}
