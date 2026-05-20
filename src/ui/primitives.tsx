/**
 * Shared UI primitives — Phase 12.30.
 *
 * Extracted from src/modules/catalog/products/_wizard.tsx so the entire
 * ERP can render forms / panels / badges with the same indigo-accent
 * sample look. Components are deliberately small and unstyled-by-default
 * (i.e. inline styles only) so they slot into either Tailwind or pure
 * inline-CSS hosts.
 *
 * Exports:
 *   Field, Input, Select, Textarea, PrefixInput  — form fields
 *   Badge                                        — colored pill
 *   Panel                                        — titled card section
 *   Grid                                         — N-column grid
 *   PageShell                                    — outer page wrapper
 *   PageHeader                                   — title + crumb + actions
 *   Stat                                         — KPI tile (label / value / hint)
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { theme, inputBaseStyle, labelStyle, focusRing } from './theme';

// ── Field wrapper ──────────────────────────────────────────────────────────
export function Field({
  label, required, hint, children,
}: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={labelStyle}>
        {label}
        {required && <span style={{ color: theme.danger }}>*</span>}
      </label>
      {children}
      {hint && (
        <p style={{ fontSize: theme.fontXs, color: theme.inkFaint, margin: 0 }}>{hint}</p>
      )}
    </div>
  );
}

// ── Input ──────────────────────────────────────────────────────────────────
export function Input(props: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  dir?: 'ltr' | 'rtl';
  min?: string;
  step?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={props.type ?? 'text'}
      value={props.value}
      onChange={props.onChange}
      placeholder={props.placeholder}
      dir={props.dir}
      min={props.min}
      step={props.step}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
      aria-label={props.ariaLabel}
      style={{ ...inputBaseStyle, ...focusRing(focused), opacity: props.disabled ? 0.6 : 1 }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

// ── Select ─────────────────────────────────────────────────────────────────
export function Select(props: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled}
      style={{
        ...inputBaseStyle,
        ...focusRing(focused),
        appearance: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 10px center',
        paddingRight: '30px',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.6 : 1,
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {props.children}
    </select>
  );
}

// ── Textarea ───────────────────────────────────────────────────────────────
export function Textarea(props: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      value={props.value}
      onChange={props.onChange}
      placeholder={props.placeholder}
      rows={props.rows ?? 3}
      disabled={props.disabled}
      style={{
        ...inputBaseStyle,
        ...focusRing(focused),
        resize: 'none',
        lineHeight: 1.5,
        opacity: props.disabled ? 0.6 : 1,
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

// ── PrefixInput (e.g. currency / unit prefix) ──────────────────────────────
export function PrefixInput(props: {
  prefix: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  min?: string;
  step?: string;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: 'flex' }}>
      <span style={{
        padding: '8px 10px',
        background: theme.panelHead,
        border: `1px solid ${theme.border}`,
        borderRight: 'none',
        borderRadius: `${theme.radius} 0 0 ${theme.radius}`,
        fontSize: theme.fontSm,
        color: theme.inkMuted,
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        fontWeight: 500,
      }}>{props.prefix}</span>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        onChange={props.onChange}
        placeholder={props.placeholder}
        min={props.min}
        step={props.step}
        disabled={props.disabled}
        style={{
          ...inputBaseStyle,
          borderRadius: `0 ${theme.radius} ${theme.radius} 0`,
          ...focusRing(focused),
          opacity: props.disabled ? 0.6 : 1,
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </div>
  );
}

// ── Badge ──────────────────────────────────────────────────────────────────
export type BadgeColor = 'blue' | 'green' | 'amber' | 'purple' | 'red' | 'slate';

export function Badge({
  children, color = 'blue',
}: { children: ReactNode; color?: BadgeColor }) {
  const palette = {
    blue:   { bg: theme.infoSoft,   text: theme.info,    border: theme.infoBorder },
    green:  { bg: theme.successSoft,text: theme.success, border: theme.successBorder },
    amber:  { bg: theme.warnSoft,   text: theme.warn,    border: theme.warnBorder },
    purple: { bg: theme.purpleSoft, text: theme.purple,  border: theme.purpleBorder },
    red:    { bg: theme.dangerSoft, text: theme.danger,  border: theme.dangerBorder },
    slate:  { bg: theme.muted,      text: theme.inkMuted,border: theme.border },
  }[color];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      fontSize: theme.fontXs, fontWeight: 600,
      padding: '3px 8px', borderRadius: '6px',
      background: palette.bg, color: palette.text, border: `1px solid ${palette.border}`,
    }}>{children}</span>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────
export function Panel({
  icon, title, right, children,
}: { icon?: ReactNode; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={{
      border: `1px solid ${theme.border}`,
      borderRadius: theme.radiusLg,
      overflow: 'hidden',
      background: theme.card,
    }}>
      <div style={{
        background: theme.panelHead,
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        borderBottom: `1px solid ${theme.border}`,
      }}>
        {icon && <span style={{ fontSize: theme.fontMd }}>{icon}</span>}
        <span style={{
          fontSize: theme.fontXs, fontWeight: 700, color: theme.inkMuted,
          textTransform: 'uppercase', letterSpacing: '.06em',
        }}>{title}</span>
        {right && <div style={{ marginInlineStart: 'auto' }}>{right}</div>}
      </div>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {children}
      </div>
    </div>
  );
}

// ── Grid ───────────────────────────────────────────────────────────────────
export function Grid({
  cols = 2, gap, children,
}: { cols?: number; gap?: string; children: ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: gap ?? '12px',
    }}>
      {children}
    </div>
  );
}

// ── Page shell ─────────────────────────────────────────────────────────────
export function PageShell({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      maxWidth: '1280px',
      margin: '0 auto',
      padding: '20px 24px',
      fontFamily: theme.font,
      color: theme.ink,
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── Page header ────────────────────────────────────────────────────────────
export function PageHeader({
  title, crumb, actions, subtitle,
}: { title: string; crumb?: ReactNode; actions?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      {crumb && (
        <div style={{ fontSize: theme.fontXs, color: theme.inkFaint, marginBottom: '6px' }}>
          {crumb}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{
            margin: 0,
            fontSize: '22px',
            fontWeight: 700,
            color: theme.ink,
            letterSpacing: '-.01em',
          }}>{title}</h1>
          {subtitle && (
            <div style={{ marginTop: '4px', fontSize: theme.fontBase, color: theme.inkMuted }}>
              {subtitle}
            </div>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>{actions}</div>}
      </div>
    </div>
  );
}

// ── KPI / Stat tile ────────────────────────────────────────────────────────
export function Stat({
  label, value, hint, color,
}: { label: string; value: ReactNode; hint?: ReactNode; color?: 'brand' | 'success' | 'danger' | 'warn' }) {
  const valueColor =
    color === 'brand'   ? theme.brand :
    color === 'success' ? theme.success :
    color === 'danger'  ? theme.danger :
    color === 'warn'    ? theme.warn :
    theme.ink;
  return (
    <div style={{
      background: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: theme.radiusLg,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      boxShadow: theme.shadowSm,
    }}>
      <div style={{
        fontSize: theme.fontXs,
        fontWeight: 600,
        color: theme.inkMuted,
        textTransform: 'uppercase',
        letterSpacing: '.05em',
      }}>{label}</div>
      <div style={{ fontSize: '20px', fontWeight: 700, color: valueColor }}>{value}</div>
      {hint && (
        <div style={{ fontSize: theme.fontXs, color: theme.inkFaint }}>{hint}</div>
      )}
    </div>
  );
}

// ── Button (used by future module screens) ─────────────────────────────────
export function Button({
  children, onClick, variant = 'primary', type = 'button', disabled, style,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const v: Record<string, CSSProperties> = {
    primary:   { background: theme.brand,    color: '#fff',          border: `1px solid ${theme.brand}` },
    secondary: { background: '#fff',         color: theme.ink,       border: `1px solid ${theme.border}` },
    ghost:     { background: 'transparent',  color: theme.inkMuted,  border: '1px solid transparent' },
    danger:    { background: theme.danger,   color: '#fff',          border: `1px solid ${theme.danger}` },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...v[variant],
        padding: '8px 14px',
        fontSize: theme.fontBase,
        fontWeight: 600,
        borderRadius: theme.radius,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'background-color .15s, border-color .15s',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
