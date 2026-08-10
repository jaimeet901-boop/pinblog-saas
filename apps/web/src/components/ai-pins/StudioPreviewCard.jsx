import TemplatePreviewCard from '@/components/ai-pins/TemplatePreviewCard';
import FacebookFeedPreviewCard from '@/components/ai-pins/FacebookFeedPreviewCard';

export default function StudioPreviewCard({
	variant = 'pinterest',
	config,
	context,
	featuredImageUrl = '',
	logoUrl = '',
	pageName = 'Your Facebook Page',
	linkUrl = '',
	imageUrl = '',
	className = '',
	compact = false,
	mediaAspectClass = 'aspect-[1200/630]',
}) {
	if (variant === 'facebook') {
		return (
			<FacebookFeedPreviewCard
				title={context?.title || ''}
				description={context?.description || ''}
				imageUrl={imageUrl || ''}
				featuredImageUrl={featuredImageUrl || ''}
				logoUrl={logoUrl || ''}
				pageName={pageName}
				linkUrl={linkUrl || context?.website || ''}
				className={className}
				compact={compact}
				mediaAspectClass={mediaAspectClass}
			/>
		);
	}

	return (
		<TemplatePreviewCard
			config={config}
			context={context}
			featuredImageUrl={featuredImageUrl}
			logoUrl={logoUrl}
			className={className}
		/>
	);
}
