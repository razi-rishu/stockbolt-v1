import { useTranslation } from 'react-i18next';
import { serviceLabel } from './gratuity';

/**
 * Length of service in the screen language. `serviceLabel` keeps its own
 * arithmetic ("3 yr 9 mo"); the numbers are read back out and put into a
 * translated sentence so Arabic reads in the right order.
 */
export function useServiceLabel(): (joiningDate: string | null | undefined) => string {
  const { t } = useTranslation();
  return (joiningDate) => {
    const label = serviceLabel(joiningDate);
    if (label === '—') return label;
    const y = /(\d+) yr/.exec(label)?.[1];
    const m = /(\d+) mo/.exec(label)?.[1];
    if (y && m) return t('payOcean.service_ym', { y, m });
    if (y) return t('payOcean.service_y', { y });
    return t('payOcean.service_m', { m: m ?? '0' });
  };
}
