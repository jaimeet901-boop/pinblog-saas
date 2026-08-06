import TemplatesPage from '@/pages/app/TemplatesPage';
import { AI_FACEBOOK_PAGES_PRODUCT } from '@/lib/studio/products';

/** AI Facebook Pages — template gallery (shared page, product-scoped routes). */
export default function AIFacebookPagesTemplatesPage() {
	return <TemplatesPage product={AI_FACEBOOK_PAGES_PRODUCT} />;
}
