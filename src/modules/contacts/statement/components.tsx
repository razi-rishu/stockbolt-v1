/**
 * Signature Statement components — Phase 14.07.
 *
 * Shared UI primitives for the new "next-gen ERP" customer + vendor
 * account statement experience. Each component is intentionally
 * self-contained (no business logic) so the customer and vendor
 * statement pages just compose them with the right data.
 *
 * Design language — kept lock-step with the Signature print system
 * (Phase 14.01):
 *   - 4mm indigo accent strip on the page chrome
 *   - hairline-only separators (no card shadows)
 *   - tabular numerics throughout
 *   - StampCard / AnchorTotal vocabulary reused from invoices
 *
 * The statement is treated as a RELATIONSHIP snapshot, not a list of
 * transactions:
 *
 *   ┌─ RelationshipHeader ────────  party left, AnchorTotal right
 *   ├─ HealthRow ─────────────────  5 KPI tiles
 *   ├─ BalanceStrip ─────────────  stacked aging bar
 *   ├─ PeriodFilter ──────────────  presets + custom range
 *   └─ TransactionSpine ──────────  opening row, ledger, closing row
 *
 * Vendor side reuses the same components with `side="vendor"` so the
 * sign convention flips ("Payable" instead of "Receivable", "Paid to"
 * vocabulary in tooltips).
 */
import { type ReactNode } from 'react';

// ── Design tokens (mirror of _signature/tokens.ts, narrowed to what
//    statements actually need) ──────────────────────────────────────────────
export const stmt = {
  brand:        '#7c3aed',
  brandSoft:    '#f5f3ff',
  ink:          '#0F172A',
  inkBody:      '#334155',
  inkMuted:     '#475569',
  inkSoft:      '#94A3B8',
  inkFaint:     '#CBD5E1',
  paper:        '#FFFFFF',
  paperSoft:    '#F8FAFC',
  hairline:     'rgba(15, 23, 42, 0.08)',
  band: {
    current: '#10B981',
    d30:     '#F59E0B',
    d60:     '#F97316',
    d90:     '#EF4444',
    over:    '#7C2D12',
  },
} as const;

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Page shell with 4mm accent strip + content area ─────────────────────────
export function StatementShell({ children }: { children: ReactNode }) {
  return (
    <div style={{
      position: 'relative',
      background: stmt.paper,
      borderRadius: '16px',
      border: `1px solid ${stmt.hairline}`,
      overflow: 'hidden',
    }}>
      {/* 4mm vertical accent strip — same indigo we use on invoices */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 0,
        width: '4px', background: stmt.brand,
      }} />
      <div style={{ padding: '28px 32px 32px 36px' }}>
        {children}
      </div>
    </div>
  );
}

// ── Small reusable label (matches SectionLabel in _signature) ───────────────
export function StmtLabel({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontSize: '10.5px',
      fontWeight: 600,
      color: stmt.inkMuted,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      ...style,
    }}>{children}</div>
  );
}

// ── RelationshipHeader — party left, anchor balance right ───────────────────
export interface PartyView {
  name:        string;
  code?:       string | null;
  trn?:        string | null;
  address?:    string | null;
  phone?:      string | null;
  email?:      string | null;
  terms?:      string | null;
  credit_limit?: number | null;
  since?:      string | null;
}

export function RelationshipHeader({
  party, balance, currency, side, statusLabel,
}: {
  party:    PartyView;
  balance:  number;
  currency: string;
  side:     'customer' | 'vendor';
  statusLabel?: string;
}) {
  const balanceLabel = side === 'customer' ? 'Receivable' : 'Payable';
  const cr = balance < 0;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto', gap: '40px',
      alignItems: 'start',
    }}>
      {/* LEFT — party identity */}
      <div>
        <StmtLabel>{side === 'customer' ? 'Customer' : 'Supplier'}</StmtLabel>
        <h1 style={{
          margin: '6px 0 4px', fontSize: '24px', fontWeight: 700,
          color: stmt.ink, letterSpacing: '-0.015em', lineHeight: 1.2,
        }}>
          {party.name}
        </h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center', fontSize: '12.5px', color: stmt.inkMuted }}>
          {party.code && <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 500 }}>{party.code}</span>}
          {party.trn && <><span style={{ color: stmt.inkFaint }}>·</span><span>TRN {party.trn}</span></>}
          {statusLabel && <>
            <span style={{ color: stmt.inkFaint }}>·</span>
            <span style={{
              display: 'inline-block', padding: '2px 8px',
              fontSize: '10.5px', fontWeight: 600, borderRadius: '999px',
              background: stmt.brandSoft, color: stmt.brand,
              letterSpacing: '0.02em',
            }}>{statusLabel}</span>
          </>}
        </div>
        <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: '12.5px', color: stmt.inkBody }}>
          {party.address && <><span style={{ color: stmt.inkSoft }}>Address</span><span>{party.address}</span></>}
          {party.phone   && <><span style={{ color: stmt.inkSoft }}>Phone</span>  <span>{party.phone}</span></>}
          {party.email   && <><span style={{ color: stmt.inkSoft }}>Email</span>  <span>{party.email}</span></>}
        </div>
        <div style={{ marginTop: '14px', display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: '12px', color: stmt.inkMuted }}>
          {party.terms && <span>Terms <strong style={{ color: stmt.inkBody, fontWeight: 600 }}>{party.terms}</strong></span>}
          {typeof party.credit_limit === 'number' && party.credit_limit > 0 && (
            <span>Credit limit <strong style={{ color: stmt.inkBody, fontWeight: 600 }}>{currency} {fmt(party.credit_limit)}</strong></span>
          )}
          {party.since && <span>Since <strong style={{ color: stmt.inkBody, fontWeight: 600 }}>{party.since}</strong></span>}
        </div>
      </div>

      {/* RIGHT — AnchorTotal balance */}
      <div style={{
        minWidth: '230px',
        padding: '18px 22px',
        border: `2px solid ${stmt.brand}`,
        borderRadius: '14px',
        background: stmt.paper,
        display: 'flex', flexDirection: 'column', gap: '4px',
      }}>
        <StmtLabel style={{ color: stmt.brand }}>
          {balanceLabel}{cr ? ' (credit)' : ''}
        </StmtLabel>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ fontSize: '13px', color: stmt.inkSoft, fontWeight: 600 }}>{currency}</span>
          <span style={{ fontSize: '28px', fontWeight: 700, color: stmt.ink, letterSpacing: '-0.015em' }}>
            {fmt(Math.abs(balance))}
          </span>
        </div>
        <div style={{ fontSize: '11px', color: stmt.inkSoft }}>
          {cr ? `${side === 'customer' ? 'Customer overpaid — credit on file' : 'We have advance with supplier'}` :
                `as of today`}
        </div>
      </div>
    </div>
  );
}

// ── HealthRow — 5 KPI tiles in a horizontal strip ───────────────────────────
export interface HealthTile {
  label:    string;
  value:    string;
  sublabel?: string;
  tone?:    'default' | 'good' | 'warn' | 'danger' | 'brand';
}

export function HealthRow({ tiles }: { tiles: HealthTile[] }) {
  const toneColor: Record<NonNullable<HealthTile['tone']>, string> = {
    default: stmt.ink,
    good:    '#047857',
    warn:    '#B45309',
    danger:  '#B91C1C',
    brand:   stmt.brand,
  };
  return (
    <div style={{
      marginTop: '24px',
      display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 140px), 1fr))`, gap: 0,
      border: `1px solid ${stmt.hairline}`,
      borderRadius: '12px',
      overflow: 'hidden',
      background: stmt.paper,
    }}>
      {tiles.map((tile, i) => (
        <div key={i} style={{
          padding: '14px 18px',
          borderRight: i < tiles.length - 1 ? `1px solid ${stmt.hairline}` : undefined,
        }}>
          <StmtLabel>{tile.label}</StmtLabel>
          <div style={{
            marginTop: '6px',
            fontSize: '17px', fontWeight: 700,
            color: toneColor[tile.tone ?? 'default'],
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.01em',
          }}>{tile.value}</div>
          {tile.sublabel && (
            <div style={{ marginTop: '2px', fontSize: '11px', color: stmt.inkSoft }}>{tile.sublabel}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── BalanceStrip — stacked horizontal aging visualization ───────────────────
export interface AgingBucket {
  label:  string;        // e.g. "Current"
  value:  number;
  color:  string;
}

export function BalanceStrip({
  buckets, currency, total, title = 'Aging composition',
}: {
  buckets:  AgingBucket[];
  currency: string;
  total:    number;
  title?:   string;
}) {
  const totalPositive = Math.max(total, 0);
  return (
    <div style={{
      marginTop: '20px',
      padding: '18px 20px',
      border: `1px solid ${stmt.hairline}`,
      borderRadius: '12px',
      background: stmt.paper,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: '12px', marginBottom: '12px',
      }}>
        <StmtLabel>{title}</StmtLabel>
        <span style={{
          fontSize: '13px', fontWeight: 600, color: stmt.ink,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {currency} {fmt(totalPositive)}
        </span>
      </div>

      {/* The stacked bar */}
      <div style={{
        display: 'flex', height: '10px', borderRadius: '999px', overflow: 'hidden',
        background: stmt.paperSoft, gap: '2px',
      }}>
        {totalPositive === 0 ? (
          <div style={{ flex: 1, background: stmt.inkFaint, opacity: 0.4 }} />
        ) : (
          buckets.map((b, i) => {
            const pct = b.value / totalPositive;
            if (pct <= 0) return null;
            return (
              <div key={i} title={`${b.label}: ${currency} ${fmt(b.value)}`}
                style={{ flex: `${pct} 0 0`, background: b.color, transition: 'flex 0.3s ease' }}
              />
            );
          })
        )}
      </div>

      {/* Labels under the bar */}
      <div style={{
        marginTop: '12px',
        display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 110px), 1fr))`, gap: '12px',
      }}>
        {buckets.map((b, i) => {
          const pct = totalPositive > 0 ? Math.round((b.value / totalPositive) * 100) : 0;
          return (
            <div key={i}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                  display: 'inline-block', width: '8px', height: '8px',
                  borderRadius: '999px', background: b.color,
                }} />
                <span style={{ fontSize: '11px', fontWeight: 600, color: stmt.inkBody, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {b.label}
                </span>
              </div>
              <div style={{ marginTop: '4px', fontSize: '13.5px', fontWeight: 600, color: stmt.ink, fontVariantNumeric: 'tabular-nums' }}>
                {fmt(b.value)}
              </div>
              <div style={{ fontSize: '10.5px', color: stmt.inkSoft, fontVariantNumeric: 'tabular-nums' }}>
                {pct}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PeriodFilter — date presets + custom range + search ─────────────────────
export type PeriodPreset = 'last_30' | 'last_90' | 'this_year' | 'last_year' | 'all' | 'custom';

export function PeriodFilter({
  preset, onPresetChange, from, to, onFromChange, onToChange,
  hideReversed, onHideReversedChange,
  search, onSearchChange,
}: {
  preset:        PeriodPreset;
  onPresetChange:(p: PeriodPreset) => void;
  from:          string;
  to:            string;
  onFromChange: (v: string) => void;
  onToChange:   (v: string) => void;
  hideReversed:  boolean;
  onHideReversedChange:(v: boolean) => void;
  search:        string;
  onSearchChange:(v: string) => void;
}) {
  const presets: Array<{ id: PeriodPreset; label: string }> = [
    { id: 'last_30',   label: 'Last 30d' },
    { id: 'last_90',   label: 'Last 90d' },
    { id: 'this_year', label: 'This year' },
    { id: 'last_year', label: 'Last year' },
    { id: 'all',       label: 'All time' },
  ];
  return (
    <div style={{
      marginTop: '24px',
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px',
    }}>
      <div style={{ display: 'flex', gap: '4px' }}>
        {presets.map(p => {
          const active = preset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onPresetChange(p.id)}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                color: active ? stmt.brand : stmt.inkMuted,
                background: active ? stmt.brandSoft : 'transparent',
                border: `1px solid ${active ? stmt.brand : stmt.hairline}`,
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >{p.label}</button>
          );
        })}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        marginInlineStart: '4px',
      }}>
        <input
          type="date" value={from}
          onChange={(e) => { onFromChange(e.target.value); onPresetChange('custom'); }}
          style={{
            padding: '5px 8px', fontSize: '12px',
            border: `1px solid ${stmt.hairline}`, borderRadius: '6px',
            color: stmt.inkBody, background: stmt.paper,
          }}
        />
        <span style={{ color: stmt.inkFaint }}>–</span>
        <input
          type="date" value={to}
          onChange={(e) => { onToChange(e.target.value); onPresetChange('custom'); }}
          style={{
            padding: '5px 8px', fontSize: '12px',
            border: `1px solid ${stmt.hairline}`, borderRadius: '6px',
            color: stmt.inkBody, background: stmt.paper,
          }}
        />
      </div>

      <input
        type="search"
        placeholder="Search voucher, reference…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{
          flex: '1 1 200px',
          minWidth: '160px',
          padding: '6px 10px', fontSize: '12px',
          border: `1px solid ${stmt.hairline}`, borderRadius: '8px',
          color: stmt.inkBody, background: stmt.paper,
        }}
      />

      <label style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        fontSize: '11.5px', color: stmt.inkMuted, cursor: 'pointer', userSelect: 'none',
      }}>
        <input
          type="checkbox" checked={hideReversed}
          onChange={(e) => onHideReversedChange(e.target.checked)}
          style={{ width: '13px', height: '13px' }}
        />
        Hide reversed entries
      </label>
    </div>
  );
}

// ── ActionShelf — floating top-right actions ────────────────────────────────
export function ActionShelf({ children }: { children: ReactNode }) {
  return (
    <div data-no-print="true" style={{
      display: 'flex', gap: '8px', alignItems: 'center',
    }}>
      {children}
    </div>
  );
}

export function ShelfButton({
  onClick, children, variant = 'ghost', disabled, title,
}: {
  onClick:  () => void;
  children: ReactNode;
  variant?: 'ghost' | 'primary';
  disabled?: boolean;
  title?:    string;
}) {
  const primary = variant === 'primary';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '7px 12px',
        fontSize: '12.5px', fontWeight: 600,
        color: primary ? stmt.paper : stmt.inkBody,
        background: primary ? stmt.brand : stmt.paper,
        border: `1px solid ${primary ? stmt.brand : stmt.hairline}`,
        borderRadius: '8px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s, border 0.15s',
      }}
    >{children}</button>
  );
}

// ── TransactionSpine — the ledger table ─────────────────────────────────────
export interface SpineLine {
  date:         string;
  doc_type:     string;    // friendly label e.g. "Invoice"
  doc_number:   string;
  reference?:   string | null;
  debit:        number;
  credit:       number;
  balance:      number;
  dimmed?:      boolean;   // for reversed/reversal rows in audit-trail mode
  onClick?:    () => void;
}

export function TransactionSpine({
  openingBalance, lines, closingBalance, currency,
}: {
  openingBalance:  number;
  lines:           SpineLine[];
  closingBalance:  number;
  currency:        string;
}) {
  const periodDebits  = lines.reduce((s, l) => s + l.debit, 0);
  const periodCredits = lines.reduce((s, l) => s + l.credit, 0);

  return (
    <div style={{
      marginTop: '20px',
      border: `1px solid ${stmt.hairline}`,
      borderRadius: '12px',
      overflow: 'hidden',
      background: stmt.paper,
    }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '13px',
        fontVariantNumeric: 'tabular-nums',
      }} className="statement-spine">
        <thead>
          <tr style={{ background: stmt.paperSoft, borderBottom: `1px solid ${stmt.hairline}` }}>
            <ThCell width="100px">Date</ThCell>
            <ThCell width="120px">Document</ThCell>
            <ThCell width="140px">Voucher</ThCell>
            <ThCell>Reference</ThCell>
            <ThCell width="120px" align="right">Debit</ThCell>
            <ThCell width="120px" align="right">Credit</ThCell>
            <ThCell width="140px" align="right" accent>Balance</ThCell>
          </tr>
        </thead>
        <tbody>
          {/* Opening row */}
          <tr style={{ borderBottom: `1px solid ${stmt.hairline}` }}>
            <td colSpan={5} style={{
              padding: '11px 14px',
              fontStyle: 'italic',
              color: stmt.inkMuted,
              fontSize: '12.5px',
            }}>Opening balance carried forward</td>
            <td style={{ padding: '11px 14px' }} />
            <td style={{
              padding: '11px 14px',
              textAlign: 'right',
              fontWeight: 600,
              color: openingBalance < 0 ? '#B91C1C' : stmt.inkBody,
              borderLeft: `1px solid ${stmt.hairline}`,
            }}>
              {fmt(Math.abs(openingBalance))}{openingBalance < 0 ? ' CR' : ''}
            </td>
          </tr>

          {/* Ledger rows */}
          {lines.length === 0 && (
            <tr>
              <td colSpan={7} style={{
                padding: '32px 16px',
                textAlign: 'center',
                color: stmt.inkSoft,
                fontSize: '13px',
              }}>
                No transactions in this period. Try widening the date range or clearing filters.
              </td>
            </tr>
          )}
          {lines.map((line, i) => (
            <SpineRow key={i} line={line} />
          ))}

          {/* Period totals (subtle, marginal) */}
          {lines.length > 0 && (
            <tr style={{ background: stmt.paperSoft }}>
              <td colSpan={4} style={{
                padding: '8px 14px',
                fontSize: '10.5px',
                fontWeight: 600,
                color: stmt.inkMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>Period totals</td>
              <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: stmt.inkBody }}>
                {fmt(periodDebits)}
              </td>
              <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: stmt.inkBody }}>
                {fmt(periodCredits)}
              </td>
              <td style={{ padding: '8px 14px', borderLeft: `1px solid ${stmt.hairline}` }} />
            </tr>
          )}

          {/* Closing row */}
          <tr style={{ borderTop: `2px solid ${stmt.brand}` }}>
            <td colSpan={5} style={{
              padding: '14px',
              fontSize: '13px',
              fontWeight: 700,
              color: stmt.ink,
            }}>Closing balance</td>
            <td style={{ padding: '14px' }} />
            <td style={{
              padding: '14px',
              textAlign: 'right',
              fontSize: '15px',
              fontWeight: 700,
              color: closingBalance < 0 ? '#B91C1C' : stmt.ink,
              borderLeft: `1px solid ${stmt.hairline}`,
              background: stmt.brandSoft,
            }}>
              {currency} {fmt(Math.abs(closingBalance))}{closingBalance < 0 ? ' CR' : ''}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ThCell({
  children, width, align = 'left', accent,
}: {
  children: ReactNode; width?: string; align?: 'left' | 'right'; accent?: boolean;
}) {
  return (
    <th style={{
      width,
      padding: '10px 14px',
      textAlign: align,
      fontSize: '10.5px',
      fontWeight: 600,
      color: stmt.inkMuted,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      borderLeft: accent ? `1px solid ${stmt.hairline}` : undefined,
    }}>{children}</th>
  );
}

function SpineRow({ line }: { line: SpineLine }) {
  const clickable = !!line.onClick;
  return (
    <tr
      onClick={line.onClick}
      style={{
        borderBottom: `1px solid ${stmt.hairline}`,
        opacity: line.dimmed ? 0.5 : 1,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'background 0.12s',
      }}
      onMouseEnter={clickable ? (e) => { (e.currentTarget as HTMLTableRowElement).style.background = stmt.paperSoft; } : undefined}
      onMouseLeave={clickable ? (e) => { (e.currentTarget as HTMLTableRowElement).style.background = ''; } : undefined}
    >
      <td style={{ padding: '10px 14px', color: stmt.inkMuted, fontSize: '12.5px' }}>{line.date}</td>
      <td style={{ padding: '10px 14px', color: stmt.inkBody, fontSize: '12.5px' }}>{line.doc_type}</td>
      <td style={{
        padding: '10px 14px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: stmt.brand,
        fontWeight: 500,
      }}>{line.doc_number}</td>
      <td style={{ padding: '10px 14px', color: stmt.inkMuted, fontSize: '12.5px' }}>{line.reference ?? '—'}</td>
      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: stmt.inkBody }}>
        {line.debit > 0 ? fmt(line.debit) : '—'}
      </td>
      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: stmt.inkBody }}>
        {line.credit > 0 ? fmt(line.credit) : '—'}
      </td>
      <td style={{
        padding: '10px 14px',
        textAlign: 'right',
        fontWeight: 600,
        color: line.balance < 0 ? '#B91C1C' : stmt.ink,
        borderLeft: `1px solid ${stmt.hairline}`,
      }}>
        {fmt(Math.abs(line.balance))}{line.balance < 0 ? ' CR' : ''}
      </td>
    </tr>
  );
}

// ── InsightStrip — soft footer with payment behaviour signals ───────────────
export interface Insight {
  label: string;
  value: string;
  hint?: string;
}

export function InsightStrip({ items }: { items: Insight[] }) {
  return (
    <div style={{
      marginTop: '20px',
      display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 150px), 1fr))`, gap: 0,
      border: `1px dashed ${stmt.hairline}`,
      borderRadius: '12px',
      overflow: 'hidden',
      background: stmt.paperSoft,
    }}>
      {items.map((it, i) => (
        <div key={i} style={{
          padding: '12px 16px',
          borderRight: i < items.length - 1 ? `1px dashed ${stmt.hairline}` : undefined,
        }}>
          <StmtLabel>{it.label}</StmtLabel>
          <div style={{
            marginTop: '4px',
            fontSize: '14.5px', fontWeight: 700, color: stmt.ink,
            fontVariantNumeric: 'tabular-nums',
          }}>{it.value}</div>
          {it.hint && (
            <div style={{ marginTop: '2px', fontSize: '10.5px', color: stmt.inkSoft }}>{it.hint}</div>
          )}
        </div>
      ))}
    </div>
  );
}
