import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import type { BalanceSheetLine, ControlAccountContactLine } from '@/data/adapter';
import { CONTROL_ACCOUNTS } from './_shared/control-account-drilldown';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

/**
 * Per-contact drill-down adapted for the 2-column Balance Sheet shape
 * (label, balance). Same data source as the shared component used by TB,
 * but renders into the narrower BS table.
 */
function BalanceSheetDrillDown({
  companyId, accountCode, asOfDate,
}: { companyId: string; accountCode: string; asOfDate: string }) {
  const { data, isFetching } = useQuery<ControlAccountContactLine[]>({
    queryKey: ['control_account_breakdown', companyId, accountCode, asOfDate],
    queryFn: () => getAdapter().reports.getControlAccountByContact(companyId, accountCode, asOfDate),
  });

  if (isFetching) {
    return (
      <tr className="bg-surface-muted/30">
        <td colSpan={2} className="px-10 py-2 text-xs text-ink-tertiary">Loading per-contact breakdown…</td>
      </tr>
    );
  }
  if (!data || data.length === 0) {
    return (
      <tr className="bg-surface-muted/30">
        <td colSpan={2} className="px-10 py-2 text-xs text-ink-tertiary">
          No per-contact rows for this account.
        </td>
      </tr>
    );
  }
  return (
    <>
      <tr className="bg-surface-muted/30">
        <td colSpan={2} className="px-10 pt-2 pb-1 text-[10px] uppercase tracking-wide text-ink-tertiary">
          Breakdown by contact ({data.length})
        </td>
      </tr>
      {data.map((line) => (
        <tr key={`bs-drill-${accountCode}-${line.contact_id ?? 'none'}`} className="bg-surface-muted/30">
          <td className="pl-10 pr-5 py-1.5 text-sm text-ink-secondary">
            <span className="me-2 text-ink-tertiary">↳</span>
            {line.contact_name}
          </td>
          <td className="px-5 py-1.5 text-end font-mono text-xs text-ink-secondary">
            {fmt(line.balance)}
          </td>
        </tr>
      ))}
    </>
  );
}

/**
 * Drill-down-aware Balance Sheet row. If the account is a control account
 * (1200, 2400, etc.), the row gets a chevron and toggles a per-contact
 * breakdown when clicked.
 */
function BSRow({
  line, companyId, asOfDate, expanded, onToggle,
}: {
  line: BalanceSheetLine;
  companyId: string;
  asOfDate: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isControl = CONTROL_ACCOUNTS.has(line.account_code);
  return (
    <>
      <tr
        className={`border-b border-border-subtle ${isControl ? 'cursor-pointer hover:bg-surface-muted/50' : ''} ${expanded ? 'bg-surface-muted/30' : ''}`}
        onClick={isControl ? onToggle : undefined}
        title={isControl ? 'Click to expand per-contact breakdown' : undefined}
      >
        <td className="px-5 py-2 text-ink-primary">
          {isControl && (
            <span className="me-2 inline-block w-3 text-ink-tertiary">
              {expanded ? '▾' : '▸'}
            </span>
          )}
          {line.account_code} {line.account_name}
        </td>
        <td className="px-5 py-2 text-end font-mono text-ink-primary">{fmt(line.balance)}</td>
      </tr>
      {isControl && expanded && (
        <BalanceSheetDrillDown
          companyId={companyId}
          accountCode={line.account_code}
          asOfDate={asOfDate}
        />
      )}
    </>
  );
}

function SubSection({
  title,
  lines,
  total,
  totalLabel,
  emptyText,
  companyId,
  asOfDate,
  expanded,
  onToggle,
}: {
  title: string;
  lines: BalanceSheetLine[];
  total: number;
  totalLabel: string;
  emptyText: string;
  companyId: string;
  asOfDate: string;
  expanded: Set<string>;
  onToggle: (code: string) => void;
}) {
  return (
    <>
      <tr className="bg-surface-muted">
        <td colSpan={2} className="px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">{title}</td>
      </tr>
      {lines.length === 0 ? (
        <tr className="border-b border-border-subtle">
          <td className="px-5 py-2 text-ink-tertiary">{emptyText}</td>
          <td className="px-5 py-2 text-end font-mono text-ink-tertiary">—</td>
        </tr>
      ) : (
        lines.map(l => (
          <BSRow
            key={l.account_code}
            line={l}
            companyId={companyId}
            asOfDate={asOfDate}
            expanded={expanded.has(l.account_code)}
            onToggle={() => onToggle(l.account_code)}
          />
        ))
      )}
      <tr className="border-b border-border-subtle bg-surface-muted font-semibold">
        <td className="px-5 py-2 text-ink-primary">{totalLabel}</td>
        <td className="px-5 py-2 text-end font-mono text-ink-primary">{fmt(total)}</td>
      </tr>
    </>
  );
}

export default function BalanceSheetPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const [asOf, setAsOf] = useState(todayIso);
  const [trigger, setTrigger] = useState(0);
  // Phase 12.24 — same per-contact drill-down pattern as TB.
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());

  function toggleExpand(code: string) {
    setExpandedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }

  const { data: bs, isLoading, error } = useQuery({
    queryKey: ['balance_sheet', company_id, asOf, trigger],
    queryFn: () => getAdapter().reports.getBalanceSheet(company_id!, asOf),
    enabled: !!company_id && trigger > 0,
  });

  const balanced = bs ? Math.abs(bs.total_assets - bs.total_liabilities - bs.total_equity) < 0.02 : true;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.bs_title')}</h1>

      <div className="flex items-center gap-3 rounded-card border border-border-subtle bg-surface-card px-5 py-3">
        <Input type="date" label={t('reports.as_of_date')} value={asOf} onChange={e => setAsOf(e.target.value)} />
        <div className="mt-5">
          <Button size="sm" onClick={() => { setTrigger(n => n + 1); setExpandedCodes(new Set()); }}>{t('reports.run')}</Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {error && <p className="text-sm text-red-600">{String(error)}</p>}

      {bs && company_id && (() => {
        // NULL sub_type defaults to 'current' — matches the adapter logic.
        const isCurrentAsset = (l: BalanceSheetLine) => l.account_type === 'asset' && l.sub_type !== 'fixed';
        const isFixedAsset   = (l: BalanceSheetLine) => l.account_type === 'asset' && l.sub_type === 'fixed';
        const isCurrentLiab  = (l: BalanceSheetLine) => l.account_type === 'liability' && l.sub_type !== 'long_term';
        const isLongTermLiab = (l: BalanceSheetLine) => l.account_type === 'liability' && l.sub_type === 'long_term';

        const currentAssetLines    = bs.lines.filter(isCurrentAsset);
        const fixedAssetLines      = bs.lines.filter(isFixedAsset);
        const currentLiabLines     = bs.lines.filter(isCurrentLiab);
        const longTermLiabLines    = bs.lines.filter(isLongTermLiab);
        const equityLines          = bs.lines.filter(l => l.account_type === 'equity');

        return (
          <>
            {!balanced && (
              <div className="rounded-input bg-red-50 px-4 py-2 text-sm text-red-700">
                {t('reports.unbalanced_warning')}
              </div>
            )}

            <div className="rounded-card border border-border-subtle bg-surface-card">
              <div className="border-b border-border-subtle px-5 py-3 text-sm text-ink-secondary">
                {t('reports.as_of_date')}: {asOf}
                <span className="ms-3 text-[11px] text-ink-tertiary">
                  · Click a control account (1200, 2100, 2400, …) to see the per-contact breakdown.
                </span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {/* ── ASSETS ──────────────────────────────────────────── */}
                  <tr className="bg-brand-50">
                    <td colSpan={2} className="px-5 py-2.5 text-sm font-bold tracking-wide text-brand-700">
                      ASSETS
                    </td>
                  </tr>
                  <SubSection
                    title="Current Assets"
                    lines={currentAssetLines}
                    total={bs.current_assets}
                    totalLabel="Total Current Assets"
                    emptyText="No current assets"
                    companyId={company_id}
                    asOfDate={asOf}
                    expanded={expandedCodes}
                    onToggle={toggleExpand}
                  />
                  <SubSection
                    title="Fixed Assets"
                    lines={fixedAssetLines}
                    total={bs.fixed_assets}
                    totalLabel="Total Fixed Assets"
                    emptyText="No fixed assets"
                    companyId={company_id}
                    asOfDate={asOf}
                    expanded={expandedCodes}
                    onToggle={toggleExpand}
                  />
                  <tr className="border-b-2 border-ink-tertiary bg-brand-50 font-bold">
                    <td className="px-5 py-2.5 text-brand-700">{t('reports.total_assets')}</td>
                    <td className="px-5 py-2.5 text-end font-mono text-brand-700">{fmt(bs.total_assets)}</td>
                  </tr>

                  {/* ── LIABILITIES ─────────────────────────────────────── */}
                  <tr className="bg-red-50">
                    <td colSpan={2} className="px-5 py-2.5 text-sm font-bold tracking-wide text-red-700">
                      LIABILITIES
                    </td>
                  </tr>
                  <SubSection
                    title="Current Liabilities"
                    lines={currentLiabLines}
                    total={bs.current_liabilities}
                    totalLabel="Total Current Liabilities"
                    emptyText="No current liabilities"
                    companyId={company_id}
                    asOfDate={asOf}
                    expanded={expandedCodes}
                    onToggle={toggleExpand}
                  />
                  <SubSection
                    title="Long-term Liabilities"
                    lines={longTermLiabLines}
                    total={bs.long_term_liabilities}
                    totalLabel="Total Long-term Liabilities"
                    emptyText="No long-term liabilities"
                    companyId={company_id}
                    asOfDate={asOf}
                    expanded={expandedCodes}
                    onToggle={toggleExpand}
                  />
                  <tr className="border-b-2 border-ink-tertiary bg-red-50 font-bold">
                    <td className="px-5 py-2.5 text-red-700">{t('reports.total_liabilities')}</td>
                    <td className="px-5 py-2.5 text-end font-mono text-red-700">{fmt(bs.total_liabilities)}</td>
                  </tr>

                  {/* ── EQUITY ──────────────────────────────────────────── */}
                  <tr className="bg-purple-50">
                    <td colSpan={2} className="px-5 py-2.5 text-sm font-bold tracking-wide text-purple-700">
                      EQUITY
                    </td>
                  </tr>
                  {equityLines.length === 0 ? (
                    <tr className="border-b border-border-subtle">
                      <td className="px-5 py-2 text-ink-tertiary">No equity accounts</td>
                      <td className="px-5 py-2 text-end font-mono text-ink-tertiary">—</td>
                    </tr>
                  ) : (
                    equityLines.map(l => (
                      <BSRow
                        key={l.account_code}
                        line={l}
                        companyId={company_id}
                        asOfDate={asOf}
                        expanded={expandedCodes.has(l.account_code)}
                        onToggle={() => toggleExpand(l.account_code)}
                      />
                    ))
                  )}
                  <tr className="border-b-2 border-ink-tertiary bg-purple-50 font-bold">
                    <td className="px-5 py-2.5 text-purple-700">{t('reports.total_equity')}</td>
                    <td className="px-5 py-2.5 text-end font-mono text-purple-700">{fmt(bs.total_equity)}</td>
                  </tr>

                  {/* ── Liabilities + Equity grand total (must equal Assets) ── */}
                  <tr className="border-t-2 border-border-subtle bg-surface-muted font-bold">
                    <td className="px-5 py-3 text-ink-primary">Total Liabilities + Equity</td>
                    <td className="px-5 py-3 text-end font-mono text-ink-primary">{fmt(bs.total_liabilities + bs.total_equity)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── Working Capital callout ──────────────────────────────── */}
            <div className="rounded-card border border-border-subtle bg-surface-card px-5 py-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">Working Capital</div>
                  <div className="mt-1 text-xs text-ink-secondary">Current Assets − Current Liabilities</div>
                </div>
                <div className={`font-mono text-lg font-semibold ${bs.working_capital < 0 ? 'text-red-600' : 'text-green-700'}`}>
                  {fmt(bs.working_capital)}
                </div>
              </div>
              {bs.working_capital < 0 && (
                <p className="mt-2 text-xs text-red-600">
                  Negative working capital means short-term liabilities exceed short-term assets — review cash position.
                </p>
              )}
            </div>
          </>
        );
      })()}
    </div>
  );
}
