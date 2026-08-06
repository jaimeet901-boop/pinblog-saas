import { AI_FACEBOOK_PAGES_PRODUCT } from '@/lib/studio/products';
import PublishingHistoryPage from '@/pages/app/PublishingHistoryPage';

/** AI Facebook Pages — publishing history (shared page, product-scoped routes). */
export default function AIFacebookPagesPublishingHistoryPage() {
	return <PublishingHistoryPage product={AI_FACEBOOK_PAGES_PRODUCT} />;
}
