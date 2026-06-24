/**
 * CompanyAvatar — the company's visual identity (Phase 28).
 *
 * Shows the uploaded company logo (companies.logo_url) as a circular, properly-
 * fit image; falls back to an initials chip derived from the company name (or a
 * provided fallback like the user's email) when no logo exists. Centralised so
 * every place that shows an avatar/logo stays consistent.
 */
import { useCompany } from '@/hooks/use-company-currency';
import { theme } from '@/ui/theme';

function initialsFrom(name: string | null | undefined, fallback: string): string {
  const src = (name && name.trim()) || fallback || '?';
  const words = src.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return src.charAt(0).toUpperCase();
}

export function CompanyAvatar({
  size = 36,
  fallbackText,
  style,
}: {
  size?: number;
  /** Used for the initials chip when there's no logo (e.g. the user's email). */
  fallbackText?: string;
  style?: React.CSSProperties;
}) {
  const company = useCompany();
  const common: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
    ...style,
  };

  if (company?.logo_url) {
    return (
      <div style={{ ...common, background: '#fff', border: `1px solid ${theme.border}` }}>
        <img
          src={company.logo_url}
          alt={company.name ?? 'Company logo'}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        ...common,
        background: theme.brand, color: '#fff',
        fontSize: Math.round(size * 0.4), fontWeight: 700, letterSpacing: '.02em',
      }}
    >
      {initialsFrom(company?.name, fallbackText ?? '')}
    </div>
  );
}
