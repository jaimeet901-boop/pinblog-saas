import { applyTemplateVariables, normalizeTemplateConfig } from '@/lib/pinTemplates';

function getAbsolutePosition(position) {
	return {
		left: `${position.x}%`,
		top: `${position.y}%`,
	};
}

export default function TemplatePreviewCard({ config, context, className = '' }) {
	const safeConfig = normalizeTemplateConfig(config);
	const ratio = safeConfig.canvas.width / safeConfig.canvas.height;
	const textStyle = {
		fontFamily: safeConfig.typography.fontFamily,
		fontSize: `${Math.max(11, safeConfig.typography.fontSize / 10)}px`,
		fontWeight: safeConfig.typography.fontWeight,
		color: safeConfig.typography.textColor,
	};

	const wrapperStyle = {
		aspectRatio: `${safeConfig.canvas.width}/${safeConfig.canvas.height}`,
		borderRadius: `${safeConfig.container.borderRadius}px`,
		padding: `${safeConfig.container.padding}px`,
		opacity: safeConfig.container.opacity,
		backgroundColor: safeConfig.background.color,
		backgroundImage: safeConfig.background.imageUrl
			? `linear-gradient(rgba(0,0,0,${1 - safeConfig.background.opacity}), rgba(0,0,0,${1 - safeConfig.background.opacity})), url(${safeConfig.background.imageUrl})`
			: undefined,
		backgroundSize: 'cover',
		backgroundPosition: 'center',
		boxShadow: safeConfig.container.shadow ? '0 18px 32px rgba(0,0,0,0.2)' : 'none',
	};

	const baseContext = {
		title: context?.title || 'Pin Title',
		description: context?.description || 'Pin Description',
		category: context?.category || 'Category',
		website: context?.website || 'Website',
		author: context?.author || 'Author',
	};

	return (
		<div className={`w-full overflow-hidden border border-border bg-card ${className}`} style={{ borderRadius: `${safeConfig.container.borderRadius}px` }}>
			<div className="relative w-full" style={wrapperStyle}>
				{safeConfig.placeholders.backgroundPattern ? (
					<div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.3) 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
				) : null}

				{safeConfig.placeholders.featuredImage ? (
					<div className="absolute inset-x-[8%] top-[42%] h-[34%] rounded-xl border border-white/45 bg-white/20 backdrop-blur-sm" />
				) : null}

				<div className="absolute max-w-[86%] whitespace-pre-wrap" style={{ ...getAbsolutePosition(safeConfig.positions.title), ...textStyle }}>
					{applyTemplateVariables('{{title}}', baseContext)}
				</div>

				<div className="absolute max-w-[86%] whitespace-pre-wrap text-xs" style={{ ...getAbsolutePosition(safeConfig.positions.description), ...textStyle, opacity: 0.86 }}>
					{applyTemplateVariables('{{description}}', baseContext)}
				</div>

				<div
					className="absolute inline-flex items-center"
					style={{
						...getAbsolutePosition(safeConfig.positions.overlayText),
						backgroundColor: safeConfig.buttonStyle.background,
						color: safeConfig.buttonStyle.textColor,
						borderRadius: `${safeConfig.buttonStyle.borderRadius}px`,
						padding: `${Math.max(6, safeConfig.buttonStyle.padding / 2)}px ${Math.max(10, safeConfig.buttonStyle.padding)}px`,
						opacity: safeConfig.buttonStyle.opacity,
						boxShadow: safeConfig.buttonStyle.shadow ? '0 8px 18px rgba(0,0,0,0.2)' : 'none',
						fontFamily: safeConfig.typography.fontFamily,
						fontWeight: safeConfig.typography.fontWeight,
						fontSize: `${Math.max(10, safeConfig.typography.fontSize / 12)}px`,
					}}
				>
					{context?.overlayText || 'Read More'}
				</div>

				{safeConfig.placeholders.websiteLogo ? (
					<div
						className="absolute inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/60 bg-white/80 text-[10px] font-semibold text-slate-700"
						style={getAbsolutePosition(safeConfig.positions.logo)}
					>
						LOGO
					</div>
				) : null}
			</div>
			<div className="flex items-center justify-between px-3 py-2 text-[11px] text-muted-foreground">
				<span>{safeConfig.canvas.width}x{safeConfig.canvas.height}</span>
				<span>ratio {ratio.toFixed(2)}</span>
			</div>
		</div>
	);
}
