/**
 * StockBolt brand logo (2026-07 rebrand) — orange three-bar mark + navy
 * "STOCKBOLT" wordmark, recreated as inline SVG from the brand sheet.
 *
 * Variants:
 *   <BrandMark>  — bare orange bars (transparent background)
 *   <BrandTile>  — app-icon: rounded square (navy or white) with the mark
 *   <BrandLogo>  — horizontal lockup: mark + STOCKBOLT wordmark
 *
 * The wordmark is always Latin "STOCKBOLT" (logos don't localize); UI text
 * references to the product name stay as regular translated text.
 */

export const BRAND_ORANGE = '#FF5B2E';
export const BRAND_NAVY = '#101B33';

/**
 * The three skewed bars, drawn in a 64×64 box (bars occupy ~8..56 × ~5..55).
 * Per the brand sheet: top bar starts leftmost, the shorter middle bar is
 * right-aligned with it, and the bottom bar is left-aligned with the middle
 * one and extends furthest right — all slanted ~25° up to the right.
 */
function Bars({ fill = BRAND_ORANGE }: { fill?: string }) {
  return (
    <g transform="translate(0 9) skewY(-25)" fill={fill}>
      <rect x="8" y="16" width="36" height="11" rx="3" />
      <rect x="20" y="30" width="24" height="11" rx="3" />
      <rect x="20" y="44" width="36" height="11" rx="3" />
    </g>
  );
}

export function BrandMark({
  size = 32,
  className = '',
  color = BRAND_ORANGE,
}: {
  size?: number;
  className?: string;
  /** Mark colour — brand orange by default; the marketing site uses teal. */
  color?: string;
}) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <Bars fill={color} />
    </svg>
  );
}

export function BrandTile({
  size = 32,
  tone = 'navy',
  className = '',
}: {
  size?: number;
  tone?: 'navy' | 'white';
  className?: string;
}) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill={tone === 'navy' ? BRAND_NAVY : '#FFFFFF'} />
      <g transform="translate(9.6 11.3) scale(0.7)">
        <Bars />
      </g>
    </svg>
  );
}

export function BrandLogo({
  mark = 32,
  text = 16,
  tone = 'navy',
  className = '',
}: {
  mark?: number;
  text?: number;
  /** Wordmark colour — navy on light surfaces, white on dark ones. */
  tone?: 'navy' | 'white';
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <BrandMark size={mark} />
      <span
        style={{
          fontSize: text,
          fontWeight: 800,
          letterSpacing: '0.1em',
          lineHeight: 1,
          color: tone === 'white' ? '#FFFFFF' : BRAND_NAVY,
        }}
      >
        STOCKBOLT
      </span>
    </span>
  );
}
