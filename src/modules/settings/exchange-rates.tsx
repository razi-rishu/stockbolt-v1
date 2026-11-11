/**
 * Exchange Rates settings — Phase 17 (multi-currency foundation).
 *
 * A clean list of common currencies, each with an editable rate INTO the
 * company base currency (base is fixed = the company's registered-country
 * currency). Manual entry now; live online rates are a later addition.
 *
 * The stored rates are what the (upcoming) posting engine uses to convert
 * foreign-currency documents to base. This page has no accounting impact on
 * its own.
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { useTranslation } from 'react-i18next';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Save, Loader2 } from 'lucide-react';
// Shared currency master list — also feeds the document currency dropdowns.
import { ALL_CURRENCIES } from '@/lib/currencies';

export default function ExchangeRatesPage() {
  const company_id = useAuthStore(s => s.company_id);
  const base = useCompanyCurrency();
  const adapter = getAdapter();
  const qc = useQueryClient();
  const { t } = useTranslation();

  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data: rates = [], isLoading } = useQuery({
    queryKey: ['exchange_rates', company_id],
    queryFn: () => adapter.exchangeRates.list(company_id!),
    enabled: !!company_id,
  });

  // Latest stored rate per "from" currency INTO base (list is date-desc, so the
  // first row seen per currency is the most recent).
  const latest: Record<string, { rate: number; date: string }> = {};
  for (const r of rates) {
    if (r.to_currency === base && !(r.from_currency in latest)) {
      latest[r.from_currency] = { rate: Number(r.exchange_rate), date: r.effective_date };
    }
  }

  // Seed the editable inputs from stored rates once loaded.
  useEffect(() => {
    if (rates.length === 0) return;
    setDraft(d => {
      if (Object.keys(d).length > 0) return d;
      const seed: Record<string, string> = {};
      for (const [cur, v] of Object.entries(latest)) seed[cur] = String(v.rate);
      return seed;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rates]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const ops = ALL_CURRENCIES
        .filter(c => c.code !== base)
        .map(c => ({ code: c.code, val: parseFloat(draft[c.code] ?? '') }))
        .filter(x => x.val > 0 && x.val !== latest[x.code]?.rate);
      for (const op of ops) {
        await adapter.exchangeRates.upsert(company_id!, {
          from_currency: op.code, to_currency: base, exchange_rate: op.val, effective_date: today,
        });
      }
      return ops.length;
    },
    onSuccess: (n) => { qc.invalidateQueries({ queryKey: ['exchange_rates', company_id] }); if (n > 0) { setSaved(true); setTimeout(() => setSaved(false), 3000); } },
    onError: (e: Error) => setError(e.message),
  });

  type Cur = (typeof ALL_CURRENCIES)[number];
  const columns: Column<Cur>[] = [
    {
      key: 'cur', header: t('settingsPages.fx.currency'),
      render: (c) => (
        <span className="sb-fx-cur">
          <bdi dir="ltr" className="sb-mono">{c.code}</bdi>
          <span className="sb-fx-name">{c.name}</span>
          {c.code === base && <span className="sb-pill">{t('settingsPages.fx.base')}</span>}
        </span>
      ),
    },
    {
      key: 'rate', header: t('settingsPages.fx.unit'),
      render: (c) => c.code === base ? (
        <bdi dir="ltr" className="sb-mono">1.00 {base}</bdi>
      ) : (
        <span className="sb-fx-input">
          <input
            type="number" min="0" step="0.00000001" dir="ltr"
            className="sb-field sb-mono"
            placeholder="0.00"
            aria-label={`${c.code} → ${base}`}
            value={draft[c.code] ?? ''}
            onChange={e => setDraft(d => ({ ...d, [c.code]: e.target.value }))}
          />
          <bdi dir="ltr" className="sb-fx-name">{base}</bdi>
        </span>
      ),
    },
    {
      key: 'date', header: t('settingsPages.fx.updated'),
      render: (c) => c.code === base ? '—' : (latest[c.code]?.date
        ? <bdi dir="ltr">{latest[c.code].date}</bdi>
        : <span className="sb-fx-name">{t('settingsPages.fx.not_set')}</span>),
    },
  ];

  // Ocean Teal (UI v1.1): look only — same rates, inputs and save rule as before.
  return (
    <OceanPage
      narrow
      testid="exchange-rates-ocean"
      title={t('settingsNav.items.exchange_rates.title')}
      subtitle={t('settingsPages.fx.subtitle', { base })}
      actions={
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 size={18} className="sb-spin" aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
          {saveMutation.isPending ? t('common.saving') : t('settingsPages.fx.save')}
        </button>
      }
    >
      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}
      {saved && <p className="sb-alert sb-alert-good" role="status">{t('settingsPages.fx.saved')}</p>}

      <p className="sb-info-note">{t('settingsPages.fx.note', { base })}</p>

      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={ALL_CURRENCIES} keyFn={(c) => c.code} rowActive={(c) => c.code === base} />}
    </OceanPage>
  );
}
