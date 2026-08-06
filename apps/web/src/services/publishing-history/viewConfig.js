import { Pin, Share2 } from 'lucide-react';
import { AI_PINS_PRODUCT } from '@/lib/studio/products';

/**
 * Product-scoped view config for the shared PublishingHistoryPage.
 *
 * @param {typeof AI_PINS_PRODUCT} [product]
 */
export function getPublishingHistoryViewConfig(product = AI_PINS_PRODUCT) {
	const channel = String(product?.destinationId || 'pinterest').trim() || 'pinterest';
	const isFacebook = channel === 'facebook';
	const labels = product?.labels || AI_PINS_PRODUCT.labels;
	const routes = product?.routes || AI_PINS_PRODUCT.routes;

	return {
		channel,
		jobBase: `/${channel}/jobs`,
		hubRoute: routes.connect,
		studioRoute: routes.studio,
		destinationFilterLabel: labels.destination,
		destinationPlural: labels.destinationPlural,
		itemSingular: labels.itemSingular,
		itemLowerPlural: labels.itemLowerPlural,
		network: labels.network,
		productShortPlural: labels.productShortPlural,
		externalLinkLabel: isFacebook ? 'Post' : 'Pin',
		scheduledStatLabel: isFacebook ? 'Scheduled Posts' : 'Scheduled Pins',
		untitledFallback: isFacebook ? 'Untitled post' : 'Untitled pin',
		emptyDescription: isFacebook
			? 'This history shows posts you publish or schedule. Create Facebook Posts for your website, publish them, then return here to track results.'
			: 'This history shows pins you publish or schedule. Create AI Pins for your website, publish them, then return here to track results.',
		emptyCtaLabel: isFacebook ? 'Create Facebook Posts' : 'Create AI Pins',
		openExternalLabel: isFacebook ? 'Open Facebook Post' : 'Open Pinterest Pin',
		hubButtonLabel: isFacebook ? 'Facebook Hub' : 'Pinterest Hub',
		accountMetaLabel: isFacebook ? 'Facebook account' : 'Pinterest account',
		subtitle: isFacebook
			? 'Track published, scheduled, and failed posts — retry or cancel without leaving the atelier.'
			: 'Track published, scheduled, and failed pins — retry or cancel without leaving the atelier.',
		PreviewIcon: isFacebook ? Share2 : Pin,
		HubIcon: isFacebook ? Share2 : Pin,
	};
}

/**
 * Resolve the external post URL from a UI row (channel-agnostic).
 *
 * @param {object} item
 */
export function externalPostUrl(item) {
	return String(
		item?.externalPostUrl
		|| item?.facebookPostUrl
		|| item?.pinterestPinUrl
		|| '',
	).trim();
}
