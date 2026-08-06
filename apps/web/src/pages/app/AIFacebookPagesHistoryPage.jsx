import AIPinHistoryPage from '@/pages/app/AIPinHistoryPage';
import { AI_FACEBOOK_PAGES_PRODUCT } from '@/lib/studio/products';

/** AI Facebook Pages — generation history (shared page, product-scoped routes). */
export default function AIFacebookPagesHistoryPage() {
	return <AIPinHistoryPage product={AI_FACEBOOK_PAGES_PRODUCT} />;
}
