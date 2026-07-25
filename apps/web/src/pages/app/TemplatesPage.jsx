import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createEmptyLayerDocument } from '@/lib/pinLayerSchema';
import { createTemplateUuid, hashTemplateConfiguration } from '@/lib/pinTemplateIdentity';
import { createTemplateThumbnail } from '@/lib/pinTemplates';
import { useToast } from '@/hooks/use-toast';
import TemplateGallery from '@/components/templates/gallery/TemplateGallery';
import {
	galleryApi,
	loadGalleryFirstPage,
	patchGalleryItem,
	removeGalleryItems,
	resetGalleryStore,
} from '@/services/templates/galleryStore';
import './TemplatesPage.css';

function downloadJson(filename, data) {
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

export default function TemplatesPage() {
	const navigate = useNavigate();
	const { toast } = useToast();

	useEffect(() => {
		loadGalleryFirstPage();
		return () => resetGalleryStore();
	}, []);

	async function handleCreate() {
		try {
			const document = createEmptyLayerDocument({ category: 'general' });
			const checksum = await hashTemplateConfiguration(document);
			const created = await galleryApi.createGalleryTemplate({
				name: 'Untitled template',
				configuration: document,
				thumbnail: createTemplateThumbnail(document),
				template_uuid: createTemplateUuid(),
				config_checksum: checksum,
				editor_version: 2,
				schema_version: document.schemaVersion,
				status: 'draft',
				visibility: 'private',
				category: 'general',
			});
			const id = created.id || created.item?.id;
			toast({ title: 'Template created' });
			if (id) navigate(`/app/ai-pins/templates/${id}/edit`);
			else loadGalleryFirstPage();
		} catch (error) {
			toast({ title: 'Create failed', description: error.message, variant: 'destructive' });
		}
	}

	async function handleFavorite(template) {
		try {
			const result = await galleryApi.favoriteTemplate(template.id);
			patchGalleryItem(template.id, { isFavorite: result.isFavorite });
		} catch (error) {
			toast({ title: 'Favorite failed', description: error.message, variant: 'destructive' });
		}
	}

	async function handleDuplicate(template) {
		try {
			await galleryApi.duplicateTemplate(template.id);
			toast({ title: 'Duplicated' });
			loadGalleryFirstPage();
		} catch (error) {
			toast({ title: 'Duplicate failed', description: error.message, variant: 'destructive' });
		}
	}

	async function handleDelete(template) {
		if (!window.confirm(`Delete “${template.name}”?`)) return;
		try {
			await galleryApi.deleteTemplate(template.id);
			removeGalleryItems([template.id]);
			toast({ title: 'Deleted' });
		} catch (error) {
			toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
		}
	}

	async function handleArchive(template) {
		try {
			const next = template.status === 'archived' ? 'draft' : 'archived';
			await galleryApi.setTemplateStatus(template.id, next);
			patchGalleryItem(template.id, { status: next });
			toast({ title: next === 'archived' ? 'Archived' : 'Restored' });
		} catch (error) {
			toast({ title: 'Status failed', description: error.message, variant: 'destructive' });
		}
	}

	async function handleExport(template) {
		try {
			const pack = await galleryApi.exportTemplate(template.id);
			downloadJson(`${template.name || 'template'}.pinblog.json`, pack);
			toast({ title: 'Exported' });
		} catch (error) {
			toast({ title: 'Export failed', description: error.message, variant: 'destructive' });
		}
	}

	async function handleRename(template) {
		const name = window.prompt('Rename template', template.name);
		if (!name || name === template.name) return;
		try {
			await galleryApi.renameTemplate(template.id, name.trim());
			patchGalleryItem(template.id, { name: name.trim() });
			toast({ title: 'Renamed' });
		} catch (error) {
			toast({ title: 'Rename failed', description: error.message, variant: 'destructive' });
		}
	}

	async function handleTouch(template) {
		try {
			await galleryApi.touchTemplate(template.id);
		} catch {
			// non-blocking
		}
	}

	async function handleBulk(action, ids) {
		if (action === 'delete' || action === 'archive') {
			const label = action === 'delete' ? 'delete' : 'archive';
			if (!window.confirm(`${label[0].toUpperCase()}${label.slice(1)} ${ids.length} template(s)?`)) {
				return;
			}
		}
		try {
			const result = await galleryApi.bulkTemplateAction(action, ids);
			if (action === 'export') {
				for (const row of result.results || []) {
					if (row.ok && row.package) {
						downloadJson(`${row.id}.pinblog.json`, row.package);
					}
				}
			}
			toast({ title: `Bulk ${action} complete` });
			loadGalleryFirstPage();
		} catch (error) {
			toast({ title: 'Bulk action failed', description: error.message, variant: 'destructive' });
		}
	}

	return (
		<div className="tpl-gallery-page">
			<div className="tpl-gallery-page__links">
				<Link to="/app/ai-pins/templates/classic" title="Legacy procedural atelier (read-only maintenance)">
					Classic atelier (legacy)
				</Link>
				<span>·</span>
				<Link to="/app/ai-pins/templates/new/edit">Blank layer editor</Link>
			</div>
			<TemplateGallery
				onCreate={handleCreate}
				onFavorite={handleFavorite}
				onDuplicate={handleDuplicate}
				onDelete={handleDelete}
				onArchive={handleArchive}
				onExport={handleExport}
				onRename={handleRename}
				onTouch={handleTouch}
				onBulk={handleBulk}
			/>
		</div>
	);
}
