import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

/**
 * Brand mark with logo URL support and Sparkles fallback.
 * Broken/empty logos never blank the UI.
 */
export default function PlatformBrandMark({
	logoUrl = '',
	size = 18,
	className = '',
	imgClassName = 'h-full w-full object-contain p-1',
}) {
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		setFailed(false);
	}, [logoUrl]);

	const showLogo = Boolean(logoUrl) && !failed;

	return (
		<span className={className}>
			{showLogo ? (
				<img
					src={logoUrl}
					alt=""
					className={imgClassName}
					onError={() => setFailed(true)}
				/>
			) : (
				<Sparkles size={size} />
			)}
		</span>
	);
}
