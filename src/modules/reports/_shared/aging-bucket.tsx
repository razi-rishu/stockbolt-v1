import { useTranslation } from 'react-i18next';

const TONE: Record<string, string> = {
  '0_30': 'sb-pill-good', '31_60': 'sb-pill-warn', '61_90': 'sb-pill-warn', over_90: 'sb-pill-bad',
};
export const AGING_BUCKETS = ['0_30', '31_60', '61_90', 'over_90'] as const;

/** Translated name of a stock-ageing bucket ("31–60 days"). */
export function useBucketLabel(): (bucket: string) => string {
  const { t } = useTranslation();
  return (bucket) => t(`rptOcean.bucket_${bucket}`, { defaultValue: bucket });
}

/** Coloured pill for a stock-ageing bucket. */
export function BucketPill({ bucket }: { bucket: string }) {
  const label = useBucketLabel();
  return <span className={`sb-pill ${TONE[bucket] ?? 'sb-pill-muted'}`}><bdi dir="ltr">{label(bucket)}</bdi></span>;
}
