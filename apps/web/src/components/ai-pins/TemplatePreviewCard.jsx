import {
	applyTemplateVariables,
	formatPinDomain,
	isV2TemplateConfig,
	normalizeTemplateConfig,
	resolveTitleBand,
} from '@/lib/pinTemplates';

function resolveOverlayCss(config) {
	const intensity = Number(config?.textOverlay?.intensity);
	const safeIntensity = Number.isFinite(intensity) ? intensity : 0.55;
	const position = config?.layout?.textPosition || 'bottom';
	const style = config?.textOverlay?.style || 'gradient';
	if (style === 'none') return 'none';
	if (style === 'dark') {
		return `linear-gradient(rgba(0,0,0,${safeIntensity * 0.55}), rgba(0,0,0,${safeIntensity * 0.55}))`;
	}
	if (style === 'vignette') {
		return `radial-gradient(circle at center, transparent 20%, rgba(0,0,0,${safeIntensity}) 100%)`;
	}
	if (position === 'top') {
		return `linear-gradient(180deg, rgba(0,0,0,${Math.min(0.9, safeIntensity + 0.1)}) 0%, rgba(0,0,0,${safeIntensity * 0.35}) 55%, transparent 100%)`;
	}
	if (position === 'center') {
		return `linear-gradient(180deg, transparent 0%, rgba(0,0,0,${safeIntensity * 0.7}) 35%, rgba(0,0,0,${safeIntensity * 0.7}) 65%, transparent 100%)`;
	}
	return `linear-gradient(180deg, transparent 0%, rgba(0,0,0,${safeIntensity * 0.25}) 35%, rgba(0,0,0,${Math.min(0.92, safeIntensity + 0.15)}) 100%)`;
}

function titleBandStyle(config) {
	const band = resolveTitleBand(config);
	return {
		top: `${band.start * 100}%`,
		bottom: `${(1 - band.end) * 100 + 8}%`,
	};
}

export default function TemplatePreviewCard({
	config,
	context,
	className = '',
	featuredImageUrl = '',
	logoUrl = '',
}) {
	// Studio card preview is procedural CSS. V2 layer docs must not crash the page.
	const safeConfig = normalizeTemplateConfig(
		isV2TemplateConfig(config) ? null : config,
	);
	const ratio = safeConfig.canvas.width / safeConfig.canvas.height;
	const backgroundImageUrl = featuredImageUrl || safeConfig.background.imageUrl || '';
	const title = applyTemplateVariables('{{title}}', {
		title: context?.title || 'Your Pin Title Looks Like This',
		description: context?.description || '',
		category: context?.category || '',
		website: context?.website || '',
		author: context?.author || '',
	});
	const domain = formatPinDomain(context?.website || '');
	const align = safeConfig.layout.textAlign || 'center';
	const band = titleBandStyle(safeConfig);
	const previewFontSize = Math.max(13, Math.min(28, safeConfig.typography.fontSize / 4.2));

	const wrapperStyle = {
		aspectRatio: `${safeConfig.canvas.width}/${safeConfig.canvas.height}`,
		borderRadius: `${Math.min(18, safeConfig.container.borderRadius || 0)}px`,
		backgroundColor: safeConfig.background.color,
		backgroundImage: backgroundImageUrl
			? `url(${backgroundImageUrl})`
			: undefined,
		backgroundSize: 'cover',
		backgroundPosition: 'center',
		boxShadow: '0 18px 36px rgba(0,0,0,0.18)',
	};

	const textBlockStyle = {
		position: 'absolute',
		left: `${(safeConfig.layout.safeMargin / safeConfig.canvas.width) * 100}%`,
		right: `${(safeConfig.layout.safeMargin / safeConfig.canvas.width) * 100}%`,
		top: band.top,
		bottom: band.bottom,
		display: 'flex',
		flexDirection: 'column',
		justifyContent: safeConfig.layout.textPosition === 'top' ? 'flex-start' : 'center',
		alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
		textAlign: align,
		zIndex: 2,
	};

	return (
		<div className={`w-full overflow-hidden border border-border bg-card ${className}`} style={{ borderRadius: `${Math.min(18, safeConfig.container.borderRadius || 12)}px` }}>
			<div className="relative w-full overflow-hidden" style={wrapperStyle}>
				{/* Readability overlay */}
				<div
					className="pointer-events-none absolute inset-0"
					style={{ backgroundImage: resolveOverlayCss(safeConfig) }}
				/>

				{!backgroundImageUrl && safeConfig.placeholders.featuredImage ? (
					<div className="absolute inset-x-[10%] top-[28%] h-[34%] rounded-2xl border border-white/30 bg-white/10" />
				) : null}

				<div style={textBlockStyle}>
					{['darkBox', 'whiteCard', 'ribbon'].includes(safeConfig.layout.frameStyle) ? (
						<div
							className="mb-1 w-full px-2 py-2"
							style={{
								background: safeConfig.layout.frameStyle === 'whiteCard'
									? 'rgba(255,255,255,0.95)'
									: safeConfig.layout.frameStyle === 'ribbon'
										? (safeConfig.decorations.brushColor || '#B91C1C')
										: 'rgba(15,23,42,0.82)',
								borderRadius: safeConfig.layout.frameStyle === 'ribbon' ? '4px' : '14px',
								color: safeConfig.layout.frameStyle === 'whiteCard' ? '#1F2937' : '#fff',
							}}
						>
							{safeConfig.decorations.roundedLabel && (context?.overlayText || context?.category) ? (
								<span
									className="mb-1 inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-[8px] font-semibold"
									style={{
										backgroundColor: safeConfig.buttonStyle.background,
										color: safeConfig.buttonStyle.textColor,
									}}
								>
									{(context?.overlayText || context?.category || '').slice(0, 28)}
								</span>
							) : null}
							<p
								className="max-w-full whitespace-pre-wrap break-words font-bold leading-tight"
								style={{
									fontFamily: safeConfig.typography.fontFamily,
									fontSize: `${previewFontSize}px`,
									fontWeight: safeConfig.typography.fontWeight,
									color: safeConfig.typography.textColor,
									lineHeight: safeConfig.typography.lineHeight,
								}}
							>
								{title}
							</p>
						</div>
					) : (
						<>
							{safeConfig.decorations.roundedLabel && (context?.overlayText || context?.category) ? (
								<span
									className="mb-2 inline-flex max-w-full truncate rounded-full px-2.5 py-1 text-[9px] font-semibold shadow"
									style={{
										backgroundColor: safeConfig.buttonStyle.background,
										color: safeConfig.buttonStyle.textColor,
									}}
								>
									{(context?.overlayText || context?.category || '').slice(0, 36)}
								</span>
							) : null}

							<div className="relative max-w-full">
								{safeConfig.decorations.brushHighlight ? (
									<span
										aria-hidden
										className="absolute inset-x-[-6%] inset-y-[-8%] -z-0 rounded-[40%] opacity-90"
										style={{ backgroundColor: safeConfig.decorations.brushColor, opacity: safeConfig.decorations.brushOpacity }}
									/>
								) : null}
								<p
									className="relative z-[1] max-w-full whitespace-pre-wrap break-words font-bold leading-tight"
									style={{
										fontFamily: safeConfig.typography.fontFamily,
										fontSize: `${previewFontSize}px`,
										fontWeight: safeConfig.typography.fontWeight,
										color: safeConfig.typography.textColor,
										lineHeight: safeConfig.typography.lineHeight,
										letterSpacing: `${safeConfig.typography.letterSpacing / 10}px`,
										textShadow: safeConfig.typography.textShadow ? '0 2px 10px rgba(0,0,0,0.45)' : 'none',
									}}
								>
									{title}
								</p>
							</div>
						</>
					)}

					{safeConfig.decorations.underline ? (
						<span
							className="mt-2 block h-0.5 w-2/5 rounded-full"
							style={{ backgroundColor: safeConfig.decorations.underlineColor }}
						/>
					) : null}

					{safeConfig.layout.showSubtitle && context?.subtitle ? (
						<p
							className="mt-2 line-clamp-2 text-[10px] font-medium opacity-85"
							style={{ color: safeConfig.typography.textColor, fontFamily: safeConfig.typography.fontFamily }}
						>
							{context.subtitle}
						</p>
					) : null}

					{safeConfig.layout.showDescription && context?.description ? (
						<p
							className="mt-2 line-clamp-2 text-[10px] opacity-90"
							style={{ color: safeConfig.typography.textColor, fontFamily: safeConfig.typography.fontFamily }}
						>
							{context.description}
						</p>
					) : null}
				</div>

				{(safeConfig.layout.showBrandBar || safeConfig.brandBar.enabled) ? (
					<div
						className="absolute inset-x-0 bottom-0 z-[3] flex h-[12%] items-center gap-2 px-[8%]"
						style={{ background: safeConfig.brandBar.background, color: safeConfig.brandBar.textColor }}
					>
						{safeConfig.brandBar.showLogo ? (
							logoUrl ? (
								<img src={logoUrl} alt="" className="h-5 w-5 rounded-full object-contain bg-white/80" />
							) : (
								<span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/85 text-[7px] font-bold text-slate-700">
									LOGO
								</span>
							)
						) : null}
						{safeConfig.brandBar.showDomain ? (
							<span className="truncate text-[9px] font-semibold tracking-wide opacity-95">
								{domain || 'yourdomain.com'}
							</span>
						) : null}
					</div>
				) : null}
			</div>
			<div className="flex items-center justify-between px-3 py-2 text-[11px] text-muted-foreground">
				<span>{safeConfig.canvas.width}×{safeConfig.canvas.height}</span>
				<span className="truncate capitalize">{safeConfig.layout.variantLabel || safeConfig.layout.textPosition} · {ratio.toFixed(2)}</span>
			</div>
		</div>
	);
}
