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
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';

// Currencies StockBolt commonly deals with (GCC + India + major trade currencies).
const ALL_CURRENCIES: { code: string; name: string }[] = [
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'QAR', name: 'Qatari Riyal' },
  { code: 'OMR', name: 'Omani Rial' },
  { code: 'BHD', name: 'Bahraini Dinar' },
  { code: 'KWD', name: 'Kuwaiti Dinar' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'PKR', name: 'Pakistani Rupee' },
];

export default function ExchangeRatesPage() {
  const company_id = useAuthStore(s => s.company_id);
  const base = useCompanyCurrency();
  const adapter = getAdapter();
  const qc = useQueryClient();

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

  const card = 'rounded-card border border-border-subtle bg-surface-card p-5';

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Exchange Rates"
        subtitle={`How many ${base} one unit of each currency is worth. Used to convert foreign-currency documents to your base currency (${base}).`}
        actions={<Button onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>{saveMutation.isPending ? 'Saving…' : 'Save rates'}</Button>}
      />

      {error && <div style={{ background: theme.dangerSoft, border: `1px solid ${theme.dangerBorder}`, borderRadius: 8, padding: '10px 16px', fontSize: 13, color: theme.danger }}>{error}</div>}
      {saved && <div style={{ background: theme.successSoft, border: `1px solid ${theme.successBorder}`, borderRadius: 8, padding: '10px 16px', fontSize: 13, color: theme.success }}>Rates saved.</div>}

      <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '10px 16px', fontSize: 13, color: '#1E40AF' }}>
        Manual entry for now — set the rate for any currency you trade in. Live online rates will be added later. Base currency ({base}) is fixed to your company's country and always 1.0.
      </div>

      <div className={card}>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-ink-tertiary">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wider text-ink-tertiary">
                <th className="py-2">Currency</th>
                <th className="py-2">1 unit =</th>
                <th className="py-2">Last updated</th>
              </tr>
            </thead>
            <tbody>
              {ALL_CURRENCIES.map(c => {
                const isBase = c.code === base;
                return (
                  <tr key={c.code} className="border-b border-border-subtle/60">
                    <td className="py-2.5">
                      <span className="font-medium text-ink-primary">{c.code}</span>
                      <span className="ml-2 text-xs text-ink-tertiary">{c.name}</span>
                      {isBase && <span className="ml-2 rounded-pill bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">Base</span>}
                    </td>
                    <td className="py-2.5">
                      {isBase ? (
                        <span className="font-mono text-ink-secondary">1.00 {base}</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="0" step="0.00000001"
                            className="h-9 w-36 rounded-input border border-border-subtle bg-surface-input px-2 text-sm font-mono text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                            placeholder="0.00"
                            value={draft[c.code] ?? ''}
                            onChange={e => setDraft(d => ({ ...d, [c.code]: e.target.value }))}
                          />
                          <span className="text-xs text-ink-tertiary">{base}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 text-xs text-ink-tertiary">
                      {isBase ? '—' : (latest[c.code]?.date ?? 'Not set')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
