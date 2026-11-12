/**
 * Drop-in "Import / Export" button — Phase 14.11c.
 *
 * Lives on every master-data list page. Navigates to the central hub
 * at /settings/import-export and (when given a `moduleKey`) pre-selects
 * that module via the ?module= query param so the operator lands
 * directly on the right card.
 *
 * Two sizes:
 *   - default: compact "⤓ Import / Export" — fits any header actions row
 *   - chip:    smaller text, no border — useful in dense list toolbars
 */
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';

interface Props {
  /** Optional — when set, pre-selects this module on the hub. Must match
   *  one of the keys in MODULES (products | contacts | coa | taxRates |
   *  units | brands | categories | salespeople | warehouses | priceLevels). */
  moduleKey?: string;
  /** Optional override label. */
  label?: string;
  /** Visual variant. */
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'primary';
}

export default function ImportExportButton({
  moduleKey, label, size = 'sm', variant = 'ghost',
}: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const onClick = () => {
    const url = moduleKey
      ? `/settings/import-export?module=${encodeURIComponent(moduleKey)}`
      : '/settings/import-export';
    navigate(url);
  };
  return (
    <Button
      size={size}
      variant={variant}
      onClick={onClick}
      title={t('settingsPages.io.button_title')}
    >
      ⤓ {label ?? t('settingsPages.io.button')}
    </Button>
  );
}
