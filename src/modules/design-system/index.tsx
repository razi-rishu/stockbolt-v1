/**
 * Design system reference page — Phase 12.44.
 *
 * Single scrollable page that renders every primitive, token, badge,
 * button, table and panel the ERP uses. Acts as a visual contract so
 * every module can be cross-checked against it.
 *
 * Routes from /design-system (wired in App.tsx).
 */
import { useState } from 'react';
import {
  PageHeader, PageShell, Panel, Field, Input, Select, Textarea,
  PrefixInput, Badge, Grid, Stat, Button,
} from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { AddNewButton } from '@/ui/add-new-button';

// ──────────────────────────────────────────────────────────────────────────
// Small helpers used only on this page
// ──────────────────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      margin: '32px 0 12px',
      fontSize: '11px',
      fontWeight: 700,
      color: theme.inkMuted,
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      paddingBottom: '6px',
      borderBottom: `1px solid ${theme.border}`,
    }}>{children}</h2>
  );
}

function Swatch({ label, value, text }: { label: string; value: string; text?: string }) {
  return (
    <div style={{
      background: theme.card, border: `1px solid ${theme.border}`,
      borderRadius: '12px', overflow: 'hidden',
      boxShadow: theme.shadowSm,
    }}>
      <div style={{
        height: '64px',
        background: value,
        color: text ?? theme.ink,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: theme.fontMono, fontSize: '12px',
      }}>{value}</div>
      <div style={{ padding: '8px 12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: theme.ink }}>{label}</div>
        <div style={{ fontFamily: theme.fontMono, fontSize: '11px', color: theme.inkFaint }}>{value}</div>
      </div>
    </div>
  );
}

function TypoRow({ label, style, sample }: { label: string; style: React.CSSProperties; sample: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', padding: '8px 0', borderBottom: `1px solid ${theme.border}` }}>
      <div style={{ width: '160px', fontSize: '11px', color: theme.inkMuted, fontFamily: theme.fontMono }}>{label}</div>
      <div style={style}>{sample}</div>
    </div>
  );
}

function PillRow({ label, tone }: { label: string; tone: { bg: string; text: string; border: string } }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 9px',
      borderRadius: '999px',
      fontSize: '11px', fontWeight: 600,
      textTransform: 'capitalize',
      background: tone.bg, color: tone.text,
      border: `1px solid ${tone.border}`,
    }}>{label}</span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

export default function DesignSystemPage() {
  const [name, setName]     = useState('');
  const [unit, setUnit]     = useState('pcs');
  const [notes, setNotes]   = useState('');
  const [price, setPrice]   = useState('');

  return (
    <PageShell>
      <PageHeader
        title="StockBolt Design System"
        subtitle="Single visual reference — every token, primitive, badge, pill, button and panel the ERP uses. Phase 12.44."
        crumb="Internal · Reference"
        actions={<Button variant="secondary" onClick={() => window.print()}>Print</Button>}
      />

      {/* ── COLOR TOKENS ─────────────────────────────────────────────── */}
      <SectionHeader>1 · Color tokens</SectionHeader>
      <p style={{ fontSize: '13px', color: theme.inkMuted, marginBottom: '12px' }}>
        Defined once in <code style={{ fontFamily: theme.fontMono, background: theme.muted, padding: '1px 6px', borderRadius: '4px', fontSize: '12px' }}>src/ui/theme.ts</code>.
        Every primitive reads from these — do not hard-code hex outside.
      </p>

      <Grid cols={4}>
        <Swatch label="brand"          value={theme.brand}     text="#fff" />
        <Swatch label="brandDeep"      value={theme.brandDeep} text="#fff" />
        <Swatch label="brandSoft"      value={theme.brandSoft} />
        <Swatch label="brandGradient"  value={theme.brandGradient} text="#fff" />
        <Swatch label="ink"            value={theme.ink}       text="#fff" />
        <Swatch label="inkMuted"       value={theme.inkMuted}  text="#fff" />
        <Swatch label="inkFaint"       value={theme.inkFaint}  text="#fff" />
        <Swatch label="page"           value={theme.page} />
        <Swatch label="card"           value={theme.card} />
        <Swatch label="muted"          value={theme.muted} />
        <Swatch label="panelHead"      value={theme.panelHead} />
        <Swatch label="border"         value={theme.border} />
      </Grid>

      <h3 style={{ marginTop: '20px', marginBottom: '8px', fontSize: '12px', fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>Status palette</h3>
      <Grid cols={4}>
        <Swatch label="success"        value={theme.success}      text="#fff" />
        <Swatch label="successSoft"    value={theme.successSoft} />
        <Swatch label="warn"           value={theme.warn}         text="#fff" />
        <Swatch label="warnSoft"       value={theme.warnSoft} />
        <Swatch label="danger"         value={theme.danger}       text="#fff" />
        <Swatch label="dangerSoft"     value={theme.dangerSoft} />
        <Swatch label="info"           value={theme.info}         text="#fff" />
        <Swatch label="infoSoft"       value={theme.infoSoft} />
        <Swatch label="purple"         value={theme.purple}       text="#fff" />
        <Swatch label="purpleSoft"     value={theme.purpleSoft} />
      </Grid>

      {/* ── TYPOGRAPHY ───────────────────────────────────────────────── */}
      <SectionHeader>2 · Typography</SectionHeader>
      <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm, padding: '16px 20px' }}>
        <TypoRow label="22px / 700 / -.01em"  style={{ fontSize: '22px',  fontWeight: 700, color: theme.ink, letterSpacing: '-.01em' }} sample="Page heading — H1" />
        <TypoRow label="14px / 700"           style={{ fontSize: '14px',  fontWeight: 700, color: theme.ink }} sample="Card / section title — H2" />
        <TypoRow label="11px UPPERCASE .06em" style={{ fontSize: '11px',  fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.06em' }} sample="Panel strip header" />
        <TypoRow label="13px regular ink"     style={{ fontSize: '13px',  color: theme.ink }} sample="Body text — slate-900" />
        <TypoRow label="12px / inkMuted"      style={{ fontSize: '12px',  color: theme.inkMuted }} sample="Secondary text — slate-500" />
        <TypoRow label="11px / inkFaint"      style={{ fontSize: '11px',  color: theme.inkFaint }} sample="Tertiary / placeholder — slate-400" />
        <TypoRow label="13px mono / ink"      style={{ fontSize: '13px',  fontFamily: theme.fontMono, color: theme.ink }} sample="1,234.56 — monospaced numbers" />
      </div>

      {/* ── BUTTONS ──────────────────────────────────────────────────── */}
      <SectionHeader>3 · Buttons</SectionHeader>
      <Panel icon="🔘" title="Variants">
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button disabled>Disabled</Button>
        </div>
        <p style={{ fontSize: '11px', color: theme.inkFaint, margin: 0 }}>
          7px radius · 8px 14px padding · 13px / 600 · indigo brand on primary.
        </p>
      </Panel>

      {/* ── INPUTS ───────────────────────────────────────────────────── */}
      <SectionHeader>4 · Form fields</SectionHeader>
      <Panel icon="✏️" title="Inputs, selects, textareas">
        <Grid cols={2}>
          <Field label="Text input" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Anything…" />
          </Field>
          <Field label="Select">
            <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="pcs">Pieces</option>
              <option value="kg">Kilograms</option>
              <option value="m">Meters</option>
            </Select>
          </Field>
          <Field label="Prefix input" hint="Currency / unit prefix on the left">
            <PrefixInput prefix="AED" value={price} onChange={(e) => setPrice(e.target.value)} type="number" />
          </Field>
          <Field label="Textarea">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes…" rows={2} />
          </Field>
        </Grid>
      </Panel>

      {/* ── BADGES + STATUS PILLS ────────────────────────────────────── */}
      <SectionHeader>5 · Badges & status pills</SectionHeader>
      <Panel icon="🏷️" title="Color-coded labels">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <Badge color="blue">Info</Badge>
          <Badge color="green">Success</Badge>
          <Badge color="amber">Warning</Badge>
          <Badge color="red">Danger</Badge>
          <Badge color="purple">Special</Badge>
          <Badge color="slate">Neutral</Badge>
        </div>
        <div style={{ height: '1px', background: theme.border, margin: '4px 0' }} />
        <p style={{ fontSize: '11px', fontWeight: 600, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.05em', margin: 0 }}>
          Document-status pills (used on invoice, payment, quote, return tables)
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <PillRow label="draft"     tone={{ bg: '#fffbeb', text: '#b45309', border: '#fde68a' }} />
          <PillRow label="sent"      tone={{ bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' }} />
          <PillRow label="confirmed" tone={{ bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' }} />
          <PillRow label="partial"   tone={{ bg: '#fffbeb', text: '#b45309', border: '#fde68a' }} />
          <PillRow label="advance"   tone={{ bg: theme.purpleSoft, text: theme.purple, border: theme.purpleBorder }} />
          <PillRow label="reconciled" tone={{ bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' }} />
          <PillRow label="expired"   tone={{ bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' }} />
          <PillRow label="void"      tone={{ bg: '#fef2f2', text: '#dc2626', border: '#fecaca' }} />
        </div>
      </Panel>

      {/* ── PANELS ───────────────────────────────────────────────────── */}
      <SectionHeader>6 · Panel</SectionHeader>
      <Panel icon="🧱" title="Light-grey strip header + bordered card">
        <p style={{ fontSize: '13px', color: theme.inkMuted, margin: 0 }}>
          Every form section, filter row, KPI group and report is wrapped in this panel.
          Strip header: <code style={{ fontFamily: theme.fontMono, fontSize: '11px' }}>#f8fafc</code> background,
          11px uppercase title, optional icon and right-slot.
        </p>
        <Grid cols={3}>
          <Field label="Cell A"><Input value="" onChange={() => {}} /></Field>
          <Field label="Cell B"><Input value="" onChange={() => {}} /></Field>
          <Field label="Cell C"><Input value="" onChange={() => {}} /></Field>
        </Grid>
      </Panel>

      {/* ── KPI / STAT TILES ─────────────────────────────────────────── */}
      <SectionHeader>7 · KPI / Stat tiles</SectionHeader>
      <Grid cols={4}>
        <Stat label="Default" value="1,234.56" hint="Optional hint text" />
        <Stat label="Brand"   value="AED 23,400" color="brand"   hint="Inventory value" />
        <Stat label="Success" value="↑ 18%"     color="success"  hint="vs last month" />
        <Stat label="Danger"  value="-820.00"   color="danger"   hint="Net loss" />
      </Grid>

      {/* ── TABLES ───────────────────────────────────────────────────── */}
      <SectionHeader>8 · Tables</SectionHeader>
      <div
        className="overflow-x-auto bg-white"
        style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
              {['Document #', 'Date', 'Customer', 'Total', 'Status'].map((c, i) => (
                <th key={i} className="px-4 py-3" style={{
                  fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                  textTransform: 'uppercase', letterSpacing: '.06em',
                  textAlign: i === 3 ? 'end' : 'start', whiteSpace: 'nowrap',
                }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { num: 'INV-1001', date: '2026-05-19', name: 'Al Madina Auto',  total: '4,250.00', status: 'confirmed' },
              { num: 'INV-1002', date: '2026-05-20', name: 'Khalifa Trading', total:   '850.50', status: 'draft' },
              { num: 'INV-1003', date: '2026-05-20', name: 'Gulf Workshop',   total: '1,920.00', status: 'void' },
            ].map((r, i) => (
              <tr key={r.num} style={{ borderTop: i === 0 ? 'none' : '1px solid #f1f5f9' }}>
                <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>{r.num}</td>
                <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{r.date}</td>
                <td className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px' }}>{r.name}</td>
                <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>{r.total}</td>
                <td className="px-4 py-3"><PillRow label={r.status} tone={
                  r.status === 'confirmed' ? { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' } :
                  r.status === 'draft'     ? { bg: '#fffbeb', text: '#b45309', border: '#fde68a' } :
                                             { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' }
                } /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── ADD-NEW AFFORDANCE ───────────────────────────────────────── */}
      <SectionHeader>9 · Add-new affordance (shared)</SectionHeader>
      <p style={{ fontSize: '13px', color: theme.inkMuted, marginBottom: '8px' }}>
        Used identically by every line picker — invoice, quote, vendor bill, PO, GRN — via
        <code style={{ fontFamily: theme.fontMono, background: theme.muted, padding: '1px 6px', borderRadius: '4px', fontSize: '12px', marginInline: '4px' }}>src/ui/add-new-button.tsx</code>.
      </p>
      <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm, maxWidth: '320px' }}>
        <AddNewButton noun="product" onClick={() => {}} />
      </div>
      <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm, maxWidth: '320px', marginTop: '8px' }}>
        <AddNewButton noun="product" query="B12-X" onClick={() => {}} />
      </div>

      {/* ── RADII + SHADOWS ─────────────────────────────────────────── */}
      <SectionHeader>10 · Radii, shadows & spacing</SectionHeader>
      <Grid cols={4}>
        <div style={{ padding: '20px', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: theme.radius,    boxShadow: theme.shadowSm }}>
          <div style={{ fontSize: '11px', color: theme.inkMuted, textTransform: 'uppercase' }}>radius</div>
          <div style={{ fontFamily: theme.fontMono, fontSize: '13px' }}>{theme.radius}</div>
        </div>
        <div style={{ padding: '20px', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: theme.radiusLg,  boxShadow: theme.shadowSm }}>
          <div style={{ fontSize: '11px', color: theme.inkMuted, textTransform: 'uppercase' }}>radiusLg</div>
          <div style={{ fontFamily: theme.fontMono, fontSize: '13px' }}>{theme.radiusLg}</div>
        </div>
        <div style={{ padding: '20px', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: theme.radiusXl,  boxShadow: theme.shadowMd }}>
          <div style={{ fontSize: '11px', color: theme.inkMuted, textTransform: 'uppercase' }}>radiusXl + shadowMd</div>
          <div style={{ fontFamily: theme.fontMono, fontSize: '13px' }}>{theme.radiusXl}</div>
        </div>
        <div style={{ padding: '20px', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: theme.radiusPill, boxShadow: theme.shadowLg }}>
          <div style={{ fontSize: '11px', color: theme.inkMuted, textTransform: 'uppercase' }}>radiusPill + shadowLg</div>
          <div style={{ fontFamily: theme.fontMono, fontSize: '13px' }}>{theme.radiusPill}</div>
        </div>
      </Grid>

      {/* ── COVERAGE FOOTNOTE ────────────────────────────────────────── */}
      <SectionHeader>11 · Where this is used</SectionHeader>
      <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm, padding: '16px 20px', fontSize: '13px', color: theme.inkMuted }}>
        <p style={{ margin: 0 }}><strong style={{ color: theme.ink }}>Direct imports of these primitives (Tier 1):</strong></p>
        <ul style={{ margin: '4px 0 12px 20px', padding: 0 }}>
          <li>Inventory wizard (5 steps, the original reference)</li>
          <li>Dashboard — KPI tiles, Sales Trend, Recent Inventory, Low-Stock Alerts</li>
          <li>Products list, Stock Ledger filters, Vendor Bills</li>
          <li>Sales invoices / quotes / payments / returns / credit notes lists</li>
          <li>Contacts list (customer + supplier)</li>
          <li>Trial Balance, P&L, Balance Sheet, Cash Flow, VAT Return</li>
          <li>Customer detail, Supplier detail (KpiTile, AgingBar, Section, StatusBadge)</li>
          <li>Settings: company, warehouses, units, price-levels, salespeople, reset, print, system-health</li>
        </ul>
        <p style={{ margin: 0 }}><strong style={{ color: theme.ink }}>Global CSS uplift covers (Tier 2):</strong></p>
        <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
          <li>Every legacy <code style={{ fontFamily: theme.fontMono, fontSize: '11px' }}>.rounded-card</code> + <code style={{ fontFamily: theme.fontMono, fontSize: '11px' }}>.rounded-lg</code> outer panel</li>
          <li>Every <code style={{ fontFamily: theme.fontMono, fontSize: '11px' }}>.bg-X-100 .text-X-700</code> status pill (banking, accounting, journal entries)</li>
          <li>Every <code style={{ fontFamily: theme.fontMono, fontSize: '11px' }}>.btn-primary</code> / <code style={{ fontFamily: theme.fontMono, fontSize: '11px' }}>.input-field</code> utility class</li>
          <li>Every legacy editor h2 and inline form label</li>
        </ul>
      </div>

      <p style={{ marginTop: '32px', fontSize: '12px', color: theme.inkFaint, textAlign: 'center' }}>
        Need to add a primitive? Edit{' '}
        <code style={{ fontFamily: theme.fontMono, background: theme.muted, padding: '1px 6px', borderRadius: '4px' }}>src/ui/primitives.tsx</code> and the token in{' '}
        <code style={{ fontFamily: theme.fontMono, background: theme.muted, padding: '1px 6px', borderRadius: '4px' }}>src/ui/theme.ts</code>.
        This page re-renders automatically.
      </p>
    </PageShell>
  );
}
