import ContentStudioPage from '@/pages/app/ContentStudioPage';
import { AI_PINS_PRODUCT } from '@/lib/studio/products';

/** AI Pins — Pinterest destination product of the shared Content Studio. */
export default function AIPinsPage() {
	return <ContentStudioPage product={AI_PINS_PRODUCT} />;
}
