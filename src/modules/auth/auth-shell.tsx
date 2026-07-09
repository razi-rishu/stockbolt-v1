import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LanguageToggle } from '@/components/language-toggle';

/**
 * Shared split-panel shell for the auth pages (2026-07 redesign).
 *
 * Left: marketing panel — logo, two-line headline with a brand-violet accent,
 * feature bullets and a testimonial card. Hidden below `lg`.
 * Right: the form panel — language toggle + account-switch link on top,
 * centred column (max 420px) that renders the page's form as children.
 *
 * Field/button primitives here are bespoke to the auth look (sentence-case
 * labels, 44px icon inputs, gradient CTA) and intentionally do not replace
 * the global Input/Button primitives used inside the app shell.
 */

// ── Icons ─────────────────────────────────────────────────────────────────────

export function IconBolt({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}

export function IconShield({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 12l1.8 1.8 3.2-3.6" />
    </svg>
  );
}

export function IconChart({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path strokeLinecap="round" d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
    </svg>
  );
}

export function IconMail({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 7l8.5 6 8.5-6" />
    </svg>
  );
}

export function IconLock({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path strokeLinecap="round" d="M8 11V8a4 4 0 118 0v3" />
    </svg>
  );
}

export function IconUser({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path strokeLinecap="round" d="M5 19.5c1.2-3 4-4.5 7-4.5s5.8 1.5 7 4.5" />
    </svg>
  );
}

export function IconEye({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconEyeOff({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M2.5 12S6 5.5 12 5.5c1.7 0 3.2.5 4.5 1.2M21.5 12S18 18.5 12 18.5c-1.7 0-3.2-.5-4.5-1.2" strokeLinecap="round" />
      <path strokeLinecap="round" d="M4 20L20 4" />
    </svg>
  );
}

export function IconCloud({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 18a4.5 4.5 0 01-.4-8.98A6 6 0 0118.3 10.6 3.75 3.75 0 0117.25 18H7z" />
    </svg>
  );
}

export function IconStore({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9l1.2-4h13.6L20 9M4 9v10a1 1 0 001 1h14a1 1 0 001-1V9M4 9h16M9.5 20v-6h5v6" />
    </svg>
  );
}

export function GoogleG({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function BrandMark({ size = 'h-10 w-10' }: { size?: string }) {
  return (
    <div className={`flex ${size} items-center justify-center rounded-xl bg-brand-500 shadow-[0_6px_14px_-4px_rgba(124,58,237,0.5)]`}>
      <IconBolt className="h-5 w-5 text-white" />
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export interface AuthFeature {
  icon: ReactNode;
  title: string;
  caption: string;
}

export interface AuthMarketing {
  line1: string;
  line2_pre: string;
  line2_accent: string;
  line2_post: string;
  subtitle: string;
  features: AuthFeature[];
  quote: string;
  author: string;
}

interface AuthShellProps {
  marketing: AuthMarketing;
  topQuestion: string;
  topLinkLabel: string;
  topLinkTo: string;
  children: ReactNode;
}

export function AuthShell({ marketing, topQuestion, topLinkLabel, topLinkTo, children }: AuthShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#ECEEF9] p-3 sm:p-6">
      <div className="grid w-full max-w-[1240px] overflow-hidden rounded-[24px] bg-white shadow-[0_24px_64px_-16px_rgba(76,29,149,0.18)] lg:min-h-[680px] lg:grid-cols-[46%_54%]">
        {/* ── Left: marketing panel ── */}
        <div className="relative hidden flex-col overflow-hidden bg-gradient-to-br from-[#F7F5FE] via-[#F3EFFD] to-[#ECE5FB] p-10 lg:flex">
          {/* decorative dot grid */}
          <svg className="absolute end-10 top-12 h-16 w-24 text-brand-300/60" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, r) =>
              Array.from({ length: 7 }).map((_, c) => (
                <circle key={`${r}-${c}`} cx={6 + c * 14} cy={6 + r * 14} r="1.6" fill="currentColor" />
              )),
            )}
          </svg>
          {/* decorative concentric circles */}
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -end-24 h-96 w-96 rounded-full border-[28px] border-brand-500/[0.05]" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-6 -end-6 h-52 w-52 rounded-full border-[20px] border-brand-500/[0.06]" />

          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-xl font-extrabold tracking-tight text-ink-primary">StockBolt</span>
          </div>

          <h1 className="mt-14 text-[34px] font-extrabold leading-[1.2] tracking-tight text-ink-primary">
            {marketing.line1}
            <br />
            {marketing.line2_pre}
            <span className="text-brand-500">{marketing.line2_accent}</span>
            {marketing.line2_post}
          </h1>

          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-ink-secondary">{marketing.subtitle}</p>

          <div className="mt-10 flex flex-col gap-6">
            {marketing.features.map((f) => (
              <div key={f.title} className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-brand-500 shadow-card">
                  {f.icon}
                </div>
                <div>
                  <p className="text-[15px] font-semibold text-ink-primary">{f.title}</p>
                  <p className="text-[13px] text-ink-secondary">{f.caption}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="relative mt-auto flex items-center justify-between gap-4 rounded-2xl bg-white p-5 shadow-card">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-serif text-2xl font-bold leading-none text-brand-500">&ldquo;</span>
                <span className="text-xs tracking-[0.15em] text-amber-400">★★★★★</span>
              </div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-primary/90">{marketing.quote}</p>
              <p className="mt-2 text-[13px] text-ink-secondary">{marketing.author}</p>
            </div>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-500">
              <IconStore />
            </div>
          </div>
        </div>

        {/* ── Right: form panel ── */}
        <div className="flex flex-col p-6 sm:p-10">
          <div className="flex items-center justify-between gap-3">
            <LanguageToggle />
            <span className="text-sm text-ink-secondary">
              {topQuestion}{' '}
              <Link to={topLinkTo} className="font-semibold text-brand-500 hover:underline">
                {topLinkLabel}
              </Link>
            </span>
          </div>

          {/* small-screen brand row (left panel is hidden) */}
          <div className="mt-8 flex items-center justify-center gap-2.5 lg:hidden">
            <BrandMark size="h-9 w-9" />
            <span className="text-lg font-extrabold tracking-tight text-ink-primary">StockBolt</span>
          </div>

          <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ── Form primitives ───────────────────────────────────────────────────────────

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon: ReactNode;
  error?: string;
  trailing?: ReactNode;
}

export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(
  ({ label, icon, error, trailing, id, className = '', ...rest }, ref) => {
    const inputId = id ?? `auth-${label.toLowerCase().replace(/\s+/g, '-')}`;
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-[13px] font-semibold text-ink-primary">
          {label}
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-tertiary">{icon}</span>
          <input
            ref={ref}
            id={inputId}
            className={`h-11 w-full rounded-xl border bg-white ps-10 text-sm text-ink-primary outline-none transition-[border-color,box-shadow] placeholder:text-ink-tertiary focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 ${
              trailing ? 'pe-11' : 'pe-3'
            } ${error ? 'border-danger-500' : 'border-border-subtle'} ${className}`}
            {...rest}
          />
          {trailing && <span className="absolute inset-y-0 end-3 flex items-center">{trailing}</span>}
        </div>
        {error && <p className="text-xs text-danger-600">{error}</p>}
      </div>
    );
  },
);
AuthField.displayName = 'AuthField';

export function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onToggle}
      className="text-ink-tertiary transition-colors hover:text-ink-secondary"
      aria-label={shown ? 'Hide password' : 'Show password'}
    >
      {shown ? <IconEyeOff /> : <IconEye />}
    </button>
  );
}

export function GoogleButton({ label, onClick, loading }: { label: string; onClick: () => void; loading?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-border-subtle bg-white text-sm font-semibold text-ink-primary transition-colors hover:bg-surface-subtle disabled:pointer-events-none disabled:opacity-60"
    >
      {loading ? <Spinner className="h-5 w-5 text-brand-500" /> : <GoogleG />}
      {label}
    </button>
  );
}

export function OrDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4" aria-hidden="true">
      <span className="h-px flex-1 bg-border-subtle" />
      <span className="text-xs font-medium tracking-[0.12em] text-ink-tertiary">{label}</span>
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  );
}

export function AuthSubmitButton({ children, loading }: { children: ReactNode; loading?: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-[#8B5CF6] text-sm font-semibold text-white shadow-[0_10px_22px_-8px_rgba(124,58,237,0.6)] transition-[filter] hover:brightness-110 active:brightness-95 disabled:pointer-events-none disabled:opacity-60"
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function SafeNote({ text }: { text: string }) {
  return (
    <p className="flex items-center justify-center gap-2 text-center text-[12.5px] text-ink-secondary">
      <IconShield className="h-4 w-4 shrink-0 text-ink-tertiary" />
      {text}
    </p>
  );
}
