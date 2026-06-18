/**
 * Exchange Rates settings — Phase 17 (multi-currency foundation).
 *
 * Manual exchange-rate entry: from → to currency, rate, effective date.
 * Used to convert foreign-currency documents to the company's base currency.
 * Posting-engine conversion is enabled in a later phase; this page is the
 * data source. No accounting impact on its own.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';

const CURRENCIES = ['AED', 'SAR', 'QAR', 'OMR', 'BHD', 'KWD', 'INR', 'USD', 'EUR', 'GBP', 'JPY'];

export default function ExchangeRatesPage() {
  const company_id = useAuthStore(s => s.company_id);
  const base = useCompanyCurrency();
  const adapter = getAdapter();
  const qc = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState('USD');
  const [to,   setTo]   = useState(base);
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);

  const { data: rates = [], isLoading } = useQuery({
    queryKey: ['exchange_rates', company_id],
    queryFn: () => adapter.exchangeRates.list(company_id!),
    enabled: !!company_id,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const r = parseFloat(rate);
      if (!from || !to) throw new Error('Pick both currencies');
      if (from === to) throw new Error('From and To currencies must differ');
      if (!(r > 0)) throw new Error('Rate must be greater than zero');
      return adapter.exchangeRates.upsert(company_id!, { from_currency: from, to_currency: to, exchange_rate: r, effective_date: date });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exchange_rates', company_id] }); setRate(''); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => adapter.exchangeRates.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exchange_rates', company_id] }),
  });

  const card = 'rounded-card border border-border-subtle bg-surface-card p-5';
  const sel = 'h-9 w-full rounded-input border border-border-subtle bg-surface-input px-2 text-sm';

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader title="Exchange Rates" subtitle={`Manual rates used to convert foreign-currency documents to your base currency (${base}).`} />

      {error && <div style={{ background: theme.dangerSoft, border: `1px solid ${theme.dangerBorder}`, borderRadius: 8, padding: '10px 16px', fontSize: 13, color: theme.danger }}>{error}</div>}

      <div className={card}>
        <h2 className="text-sm font-semibold text-ink-primary">Add a rate</h2>
        <p className="mt-1 mb-3 text-xs text-ink-tertiary">1 unit of <strong>From</strong> equals this many units of <strong>To</strong>. Tip: set To = your base currency ({base}).</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">From</label>
            <select className={sel} value={from} onChange={e => setFrom(e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">To</label>
            <select className={sel} value={to} onChange={e => setTo(e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <Input label="Rate" type="number" min="0" step="0.00000001" value={rate} onChange={e => setRate(e.target.value)} placeholder="e.g. 3.6725" />
          <Input label="Effective date" type="date" value={date} onChange={e => setDate(e.target.value)} />
          <Button onClick={() => { setError(null); addMutation.mutate(); }} disabled={addMutation.isPending}>
            {addMutation.isPending ? 'Saving…' : 'Add rate'}
          </Button>
        </div>
      </div>

      <div className={card}>
        <h2 className="mb-3 text-sm font-semibold text-ink-primary">Saved rates</h2>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-ink-tertiary">Loading…</div>
        ) : rates.length === 0 ? (
          <div className="py-6 text-center text-sm text-ink-tertiary">No exchange rates yet. Add one above.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-ink-tertiary">
                <th className="py-2">Pair</th><th className="py-2 text-right">Rate</th><th className="py-2">Effective</th><th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rates.map(r => (
                <tr key={r.id} className="border-b border-border-subtle/60">
                  <td className="py-2 font-medium text-ink-primary">{r.from_currency} → {r.to_currency}</td>
                  <td className="py-2 text-right font-mono text-ink-primary">{Number(r.exchange_rate).toLocaleString('en-US', { maximumFractionDigits: 8 })}</td>
                  <td className="py-2 text-ink-secondary">{r.effective_date}</td>
                  <td className="py-2 text-right">
                    <button className="text-xs text-red-600 hover:underline" onClick={() => removeMutation.mutate(r.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
