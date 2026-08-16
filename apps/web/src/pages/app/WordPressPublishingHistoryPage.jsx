import { WORDPRESS_PUBLISHING_PRODUCT } from '@/lib/studio/products';
import PublishingHistoryPage from '@/pages/app/PublishingHistoryPage';

/** WordPress — publishing history (shared page, channel-scoped routes). */
export default function WordPressPublishingHistoryPage() {
	return <PublishingHistoryPage product={WORDPRESS_PUBLISHING_PRODUCT} />;
}
