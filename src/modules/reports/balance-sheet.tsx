import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import type { BalanceSheetLine, ControlAccountContactLine } from '@/data/adapter';
import { CONTROL_ACCOUNTS } from './_shared/control-account-drilldown';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
      <tr style={{ background: theme.panelHead }}>
        <td colSpan={2} className="px-10 py-2" style={{ fontSize: '11px', color: theme.inkFaint }}>Loading per-contact breakdown…</td>
      </tr>
    );
  }
  if (!data || data.length === 0) {
    return (
      <tr style={{ background: theme.panelHead }}>
        <td colSpan={2} className="px-10 py-2" style={{ fontSize: '11px', color: theme.inkFaint }}>
          No per-contact rows for this account.
        </td>
      </tr>
    );
  }
  return (
    <>
      <tr style={{ background: theme.panelHead }}>
        <td colSpan={2} className="px-10 pt-2 pb-1" style={{ fontSize: '10px', color: theme.inkFaint, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Breakdown by contact ({data.length})
        </td>
      </tr>
      {data.map((line) => (
        <tr key={`bs-drill-${accountCode}-${line.contact_id ?? 'none'}`} style={{ background: theme.panelHead }}>
          <td className="py-1.5" style={{ paddingInlineStart: '40px', paddingInlineEnd: '20px', fontSize: '13px', color: theme.inkMuted }}>
            <span style={{ marginInlineEnd: '8px', color: theme.inkFaint }}>↳</span>
            {line.contact_name}
          </td>
          <td className="px-5 py-1.5 font-mono" style={{ textAlign: 'end', fontSize: '12px', color: theme.inkMuted }}>
            {fmt(line.balance)}
          </td>
        </tr>
      ))}
    </>
  );
}

/**
 * Drill-down-aware Balance Sheet row.
 * - Control accounts (1200, 2400, …): row click toggles per-contact breakdown;
 *   clicking the code badge navigates to GL ledger.
 * - Leaf accounts: whole row click navigates to GL ledger.
 */
function BSRow({
  line, companyId, asOfDate, expanded, onToggle, onNavigate,
}: {
  line: BalanceSheetLine;
  companyId: string;
  asOfDate: string;
  expanded: boolean;
  onToggle: () => void;
  onNavigate?: (code: string) => void;
}) {
  const isControl = CONTROL_ACCOUNTS.has(line.account_code);
  return (
    <>
      <tr
        onClick={isControl ? onToggle : () => onNavigate?.(line.account_code)}
        className="cursor-pointer"
        title={isControl ? 'Click to expand per-contact breakdown' : `Open ${line.account_code} in General Ledger`}
        style={{
          borderTop: '1px solid #f1f5f9',
          background: expanded ? theme.panelHead : undefined,
          transition: 'background-color .12s',
        }}
        onMouseEnter={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
        onMouseLeave={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.background = ''; }}
      >
        <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>
          {isControl && (
            <span style={{ display: 'inline-block', width: '12px', color: theme.inkFaint, marginInlineEnd: '8px' }}>
              {expanded ? '▾' : '▸'}
            </span>
          )}
          {/* For control accounts, the code is a separate GL link so as not to
              conflict with the row-click toggle. For leaf accounts, code is styled
              but the whole row is already the click target. */}
          {isControl ? (
            <span
              onClick={(e) => { e.stopPropagation(); onNavigate?.(line.account_code); }}
              title={`Open ${line.account_code} in General Ledger`}
              style={{ color: theme.brandSoftText, fontWeight: 600, marginInlineEnd: '6px', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
            >{line.account_code}</span>
          ) : (
            <span style={{ color: theme.brandSoftText, fontWeight: 600, marginInlineEnd: '6px' }}>{line.account_code}</span>
          )}
          {line.account_name}
        </td>
        <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>{fmt(line.balance)}</td>
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
  onNavigate,
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
  onNavigate?: (code: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      {/* ── Collapsible section header ── */}
      <tr
        onClick={() => setOpen(o => !o)}
        title={open ? 'Click to collapse' : 'Click to expand'}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <td colSpan={2} className="px-5 py-2" style={{
          background: '#f1f5f9',
          fontSize: '11px', fontWeight: 700, color: theme.inkMuted,
          textTransform: 'uppercase', letterSpacing: '.08em',
        }}>
          <span style={{ marginInlineEnd: '6px', fontSize: '9px', opacity: 0.6 }}>
            {open ? '▾' : '▸'}
          </span>
          {title}
          {/* Show total inline when collapsed */}
          {!open && (
            <span style={{
              float: 'right',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 700,
              color: theme.ink,
              fontSize: '12px',
              textTransform: 'none',
              letterSpacing: 0,
            }}>
              {fmt(total)}
            </span>
          )}
        </td>
      </tr>

      {/* ── Collapsible body ── */}
      {open && (
        <>
          {lines.length === 0 ? (
            <tr style={{ borderTop: '1px solid #f1f5f9' }}>
              <td className="px-5 py-2" style={{ color: theme.inkFaint, fontSize: '13px' }}>{emptyText}</td>
              <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.inkFaint, fontSize: '13px' }}>—</td>
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
                onNavigate={onNavigate}
              />
            ))
          )}
          <tr style={{ background: theme.panelHead, borderTop: '1px solid #f1f5f9', fontWeight: 600 }}>
            <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>{totalLabel}</td>
            <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>{fmt(total)}</td>
          </tr>
        </>
      )}
    </>
  );
}

export default function BalanceSheetPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 46b — as-of period picker (only `.to` matters). Auto-runs on preset.
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.balance-sheet.period', 'this_month');
  const asOf = to;
  // Phase 12.24 — same per-contact drill-down pattern as TB.
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());

  function toggleExpand(code: string) {
    setExpandedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }

  function openLedger(code: string) {
    const yearStart = asOf.slice(0, 4) + '-01-01';
    navigate(`/accounting/general-ledger?code=${encodeURIComponent(code)}&from=${yearStart}&to=${asOf}`);
  }

  const { data: bs, isLoading, error } = useQuery({
    queryKey: ['balance_sheet', company_id, asOf],
    queryFn: () => getAdapter().reports.getBalanceSheet(company_id!, asOf),
    enabled: !!company_id,
  });

  const balanced = bs ? Math.abs(bs.total_assets - bs.total_liabilities - bs.total_equity) < 0.02 : true;

  const exportRows: Record<string, unknown>[] = (bs?.lines ?? []).map((l: BalanceSheetLine) => ({
    Section: l.account_type === 'asset' ? (l.sub_type === 'fixed' ? 'Fixed Assets' : 'Current Assets')
           : l.account_type === 'liability' ? (l.sub_type === 'long_term' ? 'Long-term Liabilities' : 'Current Liabilities')
           : 'Equity',
    Code: l.account_code,
    Account: l.account_name,
    Balance: l.balance.toFixed(2),
  }));
  const exportHeaders = ['Section', 'Code', 'Account', 'Balance'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('reports.bs_title')}
        subtitle={`As of ${asOf}`}
        actions={
          <div data-print-hide style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <PeriodPicker
              mode="asOf" preset={preset} from={from} to={to}
              onPresetChange={(p) => { setPreset(p); setExpandedCodes(new Set()); }}
              onCustomRange={(f, tt) => { setCustomRange(f, tt); setExpandedCodes(new Set()); }}
            />
            <ReportActions rows={exportRows} headers={exportHeaders} filename={`balance-sheet-${asOf}`} disabled={!bs} />
          </div>
        }
      />

      {isLoading && <p style={{ fontSize: '13px', color: theme.inkMuted, padding: '24px 0', textAlign: 'center' }}>{t('common.loading')}</p>}
      {error && <p style={{ fontSize: '13px', color: theme.danger }}>{String(error)}</p>}

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
              <div style={{
                background: theme.dangerSoft,
                border: `1px solid ${theme.dangerBorder}`,
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '13px', color: theme.danger,
              }}>
                {t('reports.unbalanced_warning')}
              </div>
            )}

            <div style={{
              background: theme.card, border: `1px solid ${theme.border}`,
              borderRadius: '12px', boxShadow: theme.shadowSm, overflow: 'hidden',
            }}>
              <div style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}`, padding: '12px 20px' }}>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: theme.ink, letterSpacing: '-.01em' }}>{t('reports.bs_title')}</p>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: theme.inkMuted }}>
                  {t('reports.as_of_date')}: {asOf}
                </p>
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: theme.inkFaint }}>
                  Click any account row to open its General Ledger. Control accounts (1200, 2400, …): click the code to open GL, click the row to expand the per-contact breakdown.
                </p>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {/* ── ASSETS ──────────────────────────────────────────── */}
                  <tr>
                    <td colSpan={2} className="px-5 py-3" style={{
                      background: theme.brandSoft,
                      fontSize: '13px', fontWeight: 800,
                      color: theme.brandSoftText,
                      letterSpacing: '.06em',
                    }}>
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
                    onNavigate={openLedger}
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
                    onNavigate={openLedger}
                  />
                  <tr style={{ background: theme.brandSoft, borderTop: `2px solid ${theme.brand}`, fontWeight: 700 }}>
                    <td className="px-5 py-3" style={{ color: theme.brandSoftText, fontSize: '14px' }}>{t('reports.total_assets')}</td>
                    <td className="px-5 py-3 font-mono" style={{ textAlign: 'end', color: theme.brandSoftText, fontSize: '14px' }}>{fmt(bs.total_assets)}</td>
                  </tr>

                  {/* ── LIABILITIES ─────────────────────────────────────── */}
                  <tr>
                    <td colSpan={2} className="px-5 py-3" style={{
                      background: '#fef2f2',
                      fontSize: '13px', fontWeight: 800,
                      color: '#b91c1c',
                      letterSpacing: '.06em',
                    }}>
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
                    onNavigate={openLedger}
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
                    onNavigate={openLedger}
                  />
                  <tr style={{ background: '#fef2f2', borderTop: '2px solid #fecaca', fontWeight: 700 }}>
                    <td className="px-5 py-3" style={{ color: '#b91c1c', fontSize: '14px' }}>{t('reports.total_liabilities')}</td>
                    <td className="px-5 py-3 font-mono" style={{ textAlign: 'end', color: '#b91c1c', fontSize: '14px' }}>{fmt(bs.total_liabilities)}</td>
                  </tr>

                  {/* ── EQUITY ──────────────────────────────────────────── */}
                  <tr>
                    <td colSpan={2} className="px-5 py-3" style={{
                      background: theme.purpleSoft,
                      fontSize: '13px', fontWeight: 800,
                      color: theme.purple,
                      letterSpacing: '.06em',
                    }}>
                      EQUITY
                    </td>
                  </tr>
                  {equityLines.length === 0 ? (
                    <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td className="px-5 py-2" style={{ color: theme.inkFaint, fontSize: '13px' }}>No equity accounts</td>
                      <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.inkFaint, fontSize: '13px' }}>—</td>
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
                        onNavigate={openLedger}
                      />
                    ))
                  )}
                  <tr style={{ background: theme.purpleSoft, borderTop: `2px solid ${theme.purpleBorder}`, fontWeight: 700 }}>
                    <td className="px-5 py-3" style={{ color: theme.purple, fontSize: '14px' }}>{t('reports.total_equity')}</td>
                    <td className="px-5 py-3 font-mono" style={{ textAlign: 'end', color: theme.purple, fontSize: '14px' }}>{fmt(bs.total_equity)}</td>
                  </tr>

                  {/* ── Liabilities + Equity grand total (must equal Assets) ── */}
                  <tr style={{ background: theme.panelHead, borderTop: `2px solid ${theme.border}`, fontWeight: 700 }}>
                    <td className="px-5 py-3" style={{ color: theme.ink, fontSize: '14px' }}>Total Liabilities + Equity</td>
                    <td className="px-5 py-3 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '14px' }}>{fmt(bs.total_liabilities + bs.total_equity)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── Working Capital callout ──────────────────────────────── */}
            <div style={{
              background: theme.card, border: `1px solid ${theme.border}`,
              borderRadius: '12px', boxShadow: theme.shadowSm,
              padding: '16px 20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>Working Capital</div>
                  <div style={{ marginTop: '4px', fontSize: '12px', color: theme.inkMuted }}>Current Assets − Current Liabilities</div>
                </div>
                <div className="font-mono" style={{ fontSize: '18px', fontWeight: 700, color: bs.working_capital < 0 ? '#dc2626' : '#15803d' }}>
                  {fmt(bs.working_capital)}
                </div>
              </div>
              {bs.working_capital < 0 && (
                <p style={{ marginTop: '8px', fontSize: '11px', color: '#dc2626' }}>
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
