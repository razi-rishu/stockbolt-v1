/**
 * Landing page — premium marketing site for StockBolt ERP.
 *
 * Public page at `/` (anonymous) and `/landing`. Apple/Linear/Stripe-inspired:
 * minimal, lots of whitespace, soft gradients, glassmorphism, subtle
 * Framer-Motion reveals, Lucide icons. Light mode only. Tailwind for layout,
 * brand colours inline so they survive any Tailwind purge config.
 *
 * Screenshots: the showcase uses self-contained CSS mock UIs so the page is
 * complete with zero image assets. To use real captures, drop PNGs in
 * /public/screenshots and swap the <ModuleMock> for an <img>.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, type Variants } from 'framer-motion';
import { BrandLogo } from '@/components/brand-logo';
import {
  Boxes, Calculator, ReceiptText, Users, ShieldCheck, Languages, Warehouse,
  ScrollText, Puzzle, Check, X, ArrowRight, Sparkles, Wallet,
  Building2, Wrench, Truck, ChevronDown, Globe, Zap,
} from 'lucide-react';

// ── Brand tokens ──────────────────────────────────────────────────────────
const C = {
  primary:   '#6D28D9',
  secondary: '#8B5CF6',
  accent:    '#A855F7',
  bg:        '#F8FAFC',
  text:      '#0F172A',
  muted:     '#64748B',
  border:    'rgba(15,23,42,0.08)',
};
const GRAD = `linear-gradient(135deg, ${C.primary}, ${C.accent})`;

// ── Motion helpers ──────────────────────────────────────────────────────────
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 26 },
  show:   { opacity: 1, y: 0 },
};
function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-80px' }}
      variants={fadeUp}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

// ── Reusable glass mock "browser" frame ───────────────────────────────────────
function MockFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.7)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${C.border}`,
        borderRadius: 24,
        boxShadow: '0 30px 60px -20px rgba(76,29,149,0.30), 0 10px 30px -10px rgba(15,23,42,0.15)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.55)' }}>
        <span style={{ width: 11, height: 11, borderRadius: 99, background: '#FF5F57' }} />
        <span style={{ width: 11, height: 11, borderRadius: 99, background: '#FEBC2E' }} />
        <span style={{ width: 11, height: 11, borderRadius: 99, background: '#28C840' }} />
        <span style={{ marginInlineStart: 12, fontSize: 12, fontWeight: 600, color: C.muted }}>{title}</span>
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  );
}

const tile = (label: string, value: string, tone: string = C.primary) => (
  <div style={{ flex: 1, minWidth: 110, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>{label}</div>
    <div style={{ fontSize: 19, fontWeight: 800, color: tone, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
  </div>
);

// Each module gets a believable little UI so the showcase feels real without images.
function ModuleMock({ kind }: { kind: string }) {
  if (kind === 'dashboard') {
    return (
      <MockFrame title="StockBolt — Dashboard">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          {tile('Sales (MTD)', 'AED 412,500', C.primary)}
          {tile('Receivables', 'AED 86,200', '#0ea5e9')}
          {tile('Inventory', 'AED 1.24M', '#16a34a')}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 90, padding: '0 4px' }}>
          {[40, 62, 48, 80, 56, 92, 70, 100, 64].map((h, i) => (
            <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: 6, background: GRAD, opacity: 0.35 + h / 200 }} />
          ))}
        </div>
      </MockFrame>
    );
  }
  if (kind === 'sales') {
    return (
      <MockFrame title="StockBolt — Invoice INV-1042">
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          {tile('Total', 'AED 12,600')}
          {tile('Paid', 'AED 8,000', '#16a34a')}
          {tile('Due', 'AED 4,600', '#dc2626')}
        </div>
        {[['Shock Absorber', '4 × 1,200'], ['Brake Pad Set', '6 × 850'], ['Oil Filter', '12 × 75']].map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderTop: i ? `1px solid ${C.border}` : 'none', fontSize: 13, color: C.text }}>
            <span>{r[0]}</span><span style={{ color: C.muted, fontFamily: 'monospace' }}>{r[1]}</span>
          </div>
        ))}
      </MockFrame>
    );
  }
  if (kind === 'inventory') {
    return (
      <MockFrame title="StockBolt — Stock Movement">
        {[['Shock Absorber', 'WH-01', '218', '#16a34a'], ['Brake Pad Set', 'WH-02', '54', '#16a34a'], ['Oil Filter', 'WH-01', '6', '#d97706'], ['Clutch Kit', 'WH-02', '0', '#dc2626']].map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center', padding: '10px 0', borderTop: i ? `1px solid ${C.border}` : 'none', fontSize: 13 }}>
            <span style={{ color: C.text, fontWeight: 500 }}>{r[0]}</span>
            <span style={{ color: C.muted, fontSize: 11 }}>{r[1]}</span>
            <span style={{ color: r[3], fontWeight: 700, fontFamily: 'monospace' }}>{r[2]}</span>
          </div>
        ))}
      </MockFrame>
    );
  }
  if (kind === 'statements') {
    return (
      <MockFrame title="StockBolt — AR Aging">
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          {tile('Current', '52,000', '#16a34a')}
          {tile('31–60', '18,400', '#d97706')}
          {tile('90+', '6,100', '#dc2626')}
        </div>
        {[['Al Noor Garage', '38,200'], ['FastTrack Workshop', '21,500'], ['AIM Auto Spare', '17,000']].map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderTop: i ? `1px solid ${C.border}` : 'none', fontSize: 13, color: C.text }}>
            <span>{r[0]}</span><span style={{ fontFamily: 'monospace', color: C.muted }}>AED {r[1]}</span>
          </div>
        ))}
      </MockFrame>
    );
  }
  // accounting
  return (
    <MockFrame title="StockBolt — Trial Balance">
      {[['1100 Cash in Hand', '120,000', ''], ['1200 Accounts Receivable', '86,200', ''], ['1300 Inventory Asset', '1,240,000', ''], ['4100 Sales Revenue', '', '2,318,000'], ['2200 Output VAT', '', '115,900']].map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 14, padding: '8px 0', borderTop: i ? `1px solid ${C.border}` : 'none', fontSize: 12.5 }}>
          <span style={{ color: C.text }}>{r[0]}</span>
          <span style={{ width: 78, textAlign: 'right', fontFamily: 'monospace', color: C.muted }}>{r[1]}</span>
          <span style={{ width: 78, textAlign: 'right', fontFamily: 'monospace', color: C.muted }}>{r[2]}</span>
        </div>
      ))}
    </MockFrame>
  );
}

// ── Data ──────────────────────────────────────────────────────────────────
const SHOWCASE = [
  { kind: 'dashboard',  name: 'Dashboard',           caption: 'Real-time business insights at a glance.',         features: ['Sales KPIs', 'Receivables & payables', 'Inventory value', 'Cash flow visibility'] },
  { kind: 'sales',      name: 'Sales & Invoicing',   caption: 'Create invoices and receive payments in seconds.', features: ['VAT invoices', 'Payment tracking', 'Outstanding balances', 'Customer history'] },
  { kind: 'inventory',  name: 'Inventory',           caption: 'Track stock movement with precision.',             features: ['Multi-warehouse support', 'Stock movement', 'Moving-average costing', 'Product compatibility'] },
  { kind: 'statements', name: 'Customer Statements', caption: 'Know exactly who owes you money.',                  features: ['AR aging', 'Credit limits', 'Receivables', 'Customer history'] },
  { kind: 'accounting', name: 'Accounting',          caption: 'Built-in accounting without extra software.',      features: ['Chart of Accounts', 'Trial Balance', 'P&L & Balance Sheet', 'VAT reports'] },
];

const FEATURES = [
  { icon: Boxes,       title: 'Inventory Management',  body: 'Real-time stock across every warehouse with moving-average costing.' },
  { icon: Calculator,  title: 'Integrated Accounting', body: 'A full general ledger, trial balance and statements — no add-ons.' },
  { icon: ReceiptText, title: 'Sales & Invoicing',     body: 'VAT-ready invoices, payments and receipts in a few clicks.' },
  { icon: Users,       title: 'Customer Statements',   body: 'AR aging, credit limits and a clear picture of who owes you.' },
  { icon: ShieldCheck, title: 'VAT Compliance',        body: 'GCC VAT built in — output/input VAT and ready-to-file returns.' },
  { icon: Languages,   title: 'Arabic Support',        body: 'Full English + Arabic, right-to-left aware throughout.' },
  { icon: Warehouse,   title: 'Multi-Warehouse',       body: 'Move and value stock across multiple locations with ease.' },
  { icon: ScrollText,  title: 'Audit Logs',            body: 'Every posting tracked — reversible, traceable, audit-ready.' },
  { icon: Puzzle,      title: 'Product Compatibility', body: 'Map parts to the vehicles they fit and sell with confidence.' },
];

const COMPARE: [string, boolean | string, boolean | string][] = [
  ['Auto Parts Focus',       true, false],
  ['Inventory + Accounting', true, 'Limited'],
  ['Arabic Support',         true, 'Limited'],
  ['Affordable Pricing',     true, false],
  ['GCC VAT Ready',          true, 'Partial'],
];

const USE_CASES = [
  { icon: Building2, title: 'Retail Parts Shops', body: 'Manage thousands of SKUs effortlessly.' },
  { icon: Wrench,    title: 'Workshops',          body: 'Track inventory and invoices in one place.' },
  { icon: Truck,     title: 'Distributors',       body: 'Control stock across warehouses.' },
];

const PROOF = [
  { icon: Zap,         label: 'Inventory + Accounting in one platform' },
  { icon: Globe,       label: 'Built for GCC businesses' },
  { icon: Languages,   label: 'Arabic & English ready' },
  { icon: ShieldCheck, label: 'VAT compliant' },
];

const FAQS = [
  { q: 'What businesses is StockBolt built for?', a: 'StockBolt is purpose-built for retail auto parts shops, workshops and distributors — typically 1–5 users — who need inventory and accounting in one affordable system.' },
  { q: 'Does StockBolt support UAE VAT?', a: 'Yes. GCC VAT is built in — input and output VAT are tracked automatically on every invoice and bill, with VAT-return reports ready to file.' },
  { q: 'Does StockBolt support Arabic?', a: 'Yes. The entire interface is available in both English and Arabic with full right-to-left support.' },
  { q: 'Can I manage inventory and accounting together?', a: "Absolutely — that's the core idea. Every sale, purchase and payment posts to a real double-entry general ledger automatically. No second accounting tool needed." },
  { q: 'Is StockBolt cloud based?', a: 'Yes. StockBolt runs in the cloud — access it from any browser, with your data securely isolated per business.' },
];

// ── Page ────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [faqOpen, setFaqOpen] = useState<number | null>(0);

  // Lightweight SEO — title + description (no react-helmet dependency).
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'StockBolt ERP — Inventory & Accounting for Auto Parts Businesses';
    const meta = document.querySelector('meta[name="description"]') ?? (() => {
      const m = document.createElement('meta'); m.setAttribute('name', 'description'); document.head.appendChild(m); return m;
    })();
    const prevDesc = meta.getAttribute('content');
    meta.setAttribute('content', 'StockBolt is the affordable, all-in-one inventory and accounting ERP built specifically for auto parts retailers. VAT-ready, Arabic support, cloud based. Free during launch.');
    return () => { document.title = prevTitle; if (prevDesc) meta.setAttribute('content', prevDesc); };
  }, []);

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif', overflowX: 'hidden' }}>
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(248,250,252,0.72)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: `1px solid ${C.border}` }}>
        <nav className="mx-auto flex items-center justify-between px-5 md:px-8" style={{ maxWidth: 1200, height: 64 }}>
          <Link to="/" className="flex items-center" aria-label="StockBolt home">
            <BrandLogo mark={32} text={16} />
          </Link>
          <div className="hidden items-center gap-7 md:flex" style={{ fontSize: 14, fontWeight: 500, color: C.muted }}>
            <a href="#features" className="transition-colors hover:text-slate-900">Features</a>
            <a href="#why" className="transition-colors hover:text-slate-900">Why StockBolt</a>
            <a href="#pricing" className="transition-colors hover:text-slate-900">Pricing</a>
            <a href="#faq" className="transition-colors hover:text-slate-900">FAQ</a>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/login" className="hidden rounded-full px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 sm:inline-block" style={{ color: C.text }}>Sign in</Link>
            <Link to="/register" className="rounded-full px-4 py-2 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5" style={{ background: GRAD, boxShadow: '0 8px 20px -6px rgba(109,40,217,.5)' }}>Start Free</Link>
          </div>
        </nav>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section style={{ position: 'relative' }}>
        <div aria-hidden style={{ position: 'absolute', top: -120, right: -80, width: 460, height: 460, background: `radial-gradient(circle, ${C.accent}33, transparent 65%)`, filter: 'blur(20px)', pointerEvents: 'none' }} />
        <div aria-hidden style={{ position: 'absolute', top: 120, left: -120, width: 420, height: 420, background: `radial-gradient(circle, ${C.secondary}26, transparent 65%)`, filter: 'blur(20px)', pointerEvents: 'none' }} />
        <div className="mx-auto grid items-center gap-12 px-5 md:px-8 lg:grid-cols-2" style={{ maxWidth: 1200, paddingTop: 72, paddingBottom: 80 }}>
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: '#fff', border: `1px solid ${C.border}`, fontSize: 13, fontWeight: 600, color: C.primary, boxShadow: '0 2px 8px rgba(15,23,42,.04)' }}>
              <Sparkles size={14} /> Built for Auto Parts Businesses
            </span>
            <h1 style={{ fontSize: 'clamp(34px, 5vw, 56px)', lineHeight: 1.05, fontWeight: 800, letterSpacing: '-.03em', marginTop: 20 }}>
              The affordable alternative to{' '}
              <span style={{ background: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>expensive ERP software.</span>
            </h1>
            <p style={{ fontSize: 'clamp(16px, 2vw, 19px)', lineHeight: 1.6, color: C.muted, marginTop: 22, maxWidth: 540 }}>
              Manage inventory, sales, purchasing and accounting from one powerful platform built specifically for auto parts retailers.
            </p>
            <div className="flex flex-wrap items-center gap-3" style={{ marginTop: 30 }}>
              <Link to="/register" className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-base font-semibold text-white transition-transform hover:-translate-y-0.5" style={{ background: GRAD, boxShadow: '0 14px 30px -8px rgba(109,40,217,.55)' }}>
                Start Free <ArrowRight size={18} />
              </Link>
              <a href="mailto:sales@stockbolt.com?subject=StockBolt%20Demo" className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-base font-semibold transition-colors hover:bg-white" style={{ border: `1px solid ${C.border}`, color: C.text, background: 'rgba(255,255,255,.6)' }}>
                Book a Demo
              </a>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2" style={{ marginTop: 26, fontSize: 13.5, color: C.muted, fontWeight: 500 }}>
              {['Free during launch', 'UAE VAT Ready', 'Arabic Support', 'Cloud Based'].map(t => (
                <span key={t} className="inline-flex items-center gap-1.5"><Check size={15} color={C.primary} /> {t}</span>
              ))}
            </div>
          </Reveal>
          <Reveal delay={0.15}>
            <motion.div initial={{ rotate: 1.5 }} animate={{ rotate: 0 }} transition={{ duration: 1, ease: 'easeOut' }}>
              <ModuleMock kind="dashboard" />
            </motion.div>
          </Reveal>
        </div>
      </section>

      {/* ── Screenshot showcase ─────────────────────────────────────────── */}
      <section id="product" style={{ paddingTop: 40, paddingBottom: 40 }}>
        <div className="mx-auto px-5 md:px-8" style={{ maxWidth: 1200 }}>
          {SHOWCASE.map((m, i) => (
            <div key={m.kind} className="grid items-center gap-10 lg:grid-cols-2" style={{ paddingTop: 56, paddingBottom: 56 }}>
              <Reveal className={i % 2 === 1 ? 'lg:order-2' : ''}>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: C.accent }}>{m.name}</span>
                <h3 style={{ fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 800, letterSpacing: '-.02em', marginTop: 10, lineHeight: 1.15 }}>{m.caption}</h3>
                <ul style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {m.features.map(f => (
                    <li key={f} className="flex items-center gap-3" style={{ fontSize: 15.5, color: C.text }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: `${C.primary}14`, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Check size={13} color={C.primary} /></span>
                      {f}
                    </li>
                  ))}
                </ul>
              </Reveal>
              <Reveal delay={0.1} className={i % 2 === 1 ? 'lg:order-1' : ''}>
                <ModuleMock kind={m.kind} />
              </Reveal>
            </div>
          ))}
        </div>
      </section>

      {/* ── Feature grid ────────────────────────────────────────────────── */}
      <section id="features" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div className="mx-auto px-5 md:px-8" style={{ maxWidth: 1200 }}>
          <Reveal>
            <h2 style={{ textAlign: 'center', fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-.025em' }}>Everything your shop runs on</h2>
            <p style={{ textAlign: 'center', color: C.muted, fontSize: 18, marginTop: 14, maxWidth: 560, marginInline: 'auto' }}>One platform for inventory, accounting, sales and compliance — nothing bolted on.</p>
          </Reveal>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" style={{ marginTop: 48 }}>
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 0.08}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  style={{ height: '100%', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 24, padding: 26, boxShadow: '0 1px 2px rgba(15,23,42,.04)' }}
                >
                  <span style={{ width: 48, height: 48, borderRadius: 14, background: `linear-gradient(135deg, ${C.primary}1a, ${C.accent}1a)`, display: 'grid', placeItems: 'center' }}>
                    <f.icon size={24} color={C.primary} />
                  </span>
                  <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 18 }}>{f.title}</h3>
                  <p style={{ color: C.muted, fontSize: 14.5, lineHeight: 1.6, marginTop: 8 }}>{f.body}</p>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why StockBolt (comparison) ──────────────────────────────────── */}
      <section id="why" style={{ paddingTop: 40, paddingBottom: 80 }}>
        <div className="mx-auto px-5 md:px-8" style={{ maxWidth: 920 }}>
          <Reveal>
            <h2 style={{ textAlign: 'center', fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-.025em' }}>Why auto parts businesses choose StockBolt</h2>
          </Reveal>
          <Reveal delay={0.1}>
            <div style={{ marginTop: 40, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 24, overflow: 'hidden', boxShadow: '0 20px 50px -25px rgba(15,23,42,.2)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', background: 'rgba(248,250,252,.8)', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ padding: '16px 20px', fontWeight: 700, fontSize: 14 }}>Feature</div>
                <div style={{ padding: '16px 12px', fontWeight: 800, fontSize: 14, textAlign: 'center', color: C.primary }}>StockBolt</div>
                <div style={{ padding: '16px 12px', fontWeight: 700, fontSize: 14, textAlign: 'center', color: C.muted }}>Zoho</div>
              </div>
              {COMPARE.map((row, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', borderTop: i ? `1px solid ${C.border}` : 'none' }}>
                  <div style={{ padding: '15px 20px', fontSize: 14.5, color: C.text }}>{row[0]}</div>
                  <div style={{ padding: '15px 12px', display: 'grid', placeItems: 'center' }}>
                    {row[1] === true ? <Check size={20} color="#16a34a" /> : <span style={{ fontSize: 13, color: C.muted }}>{String(row[1])}</span>}
                  </div>
                  <div style={{ padding: '15px 12px', display: 'grid', placeItems: 'center' }}>
                    {row[2] === false ? <X size={19} color="#dc2626" /> : row[2] === true ? <Check size={20} color="#16a34a" /> : <span style={{ fontSize: 13, color: C.muted }}>{String(row[2])}</span>}
                  </div>
                </div>
              ))}
            </div>
            <p style={{ textAlign: 'center', fontSize: 12.5, color: C.muted, marginTop: 14 }}>Comparison based on publicly available information.</p>
          </Reveal>
        </div>
      </section>

      {/* ── Use cases ───────────────────────────────────────────────────── */}
      <section style={{ paddingTop: 20, paddingBottom: 80 }}>
        <div className="mx-auto px-5 md:px-8" style={{ maxWidth: 1100 }}>
          <div className="grid gap-5 md:grid-cols-3">
            {USE_CASES.map((u, i) => (
              <Reveal key={u.title} delay={i * 0.08}>
                <div style={{ height: '100%', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 24, padding: 28, boxShadow: '0 1px 2px rgba(15,23,42,.04)' }}>
                  <span style={{ width: 46, height: 46, borderRadius: 13, background: GRAD, display: 'grid', placeItems: 'center', boxShadow: '0 8px 18px -6px rgba(109,40,217,.5)' }}>
                    <u.icon size={22} color="#fff" />
                  </span>
                  <h3 style={{ fontSize: 19, fontWeight: 700, marginTop: 18 }}>{u.title}</h3>
                  <p style={{ color: C.muted, fontSize: 15, marginTop: 8, lineHeight: 1.6 }}>{u.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Social proof strip ──────────────────────────────────────────── */}
      <section style={{ paddingBottom: 70 }}>
        <div className="mx-auto px-5 md:px-8" style={{ maxWidth: 1100 }}>
          <Reveal>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" style={{ background: GRAD, borderRadius: 28, padding: '36px 28px', boxShadow: '0 30px 60px -25px rgba(109,40,217,.5)' }}>
              {PROOF.map(p => (
                <div key={p.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, color: '#fff' }}>
                  <span style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,.18)', display: 'grid', placeItems: 'center' }}><p.icon size={22} color="#fff" /></span>
                  <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4, opacity: .95 }}>{p.label}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <section id="pricing" style={{ paddingTop: 40, paddingBottom: 90 }}>
        <div className="mx-auto px-5 md:px-8" style={{ maxWidth: 720 }}>
          <Reveal>
            <div style={{ textAlign: 'center', background: 'rgba(255,255,255,.7)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${C.border}`, borderRadius: 28, padding: '52px 32px', boxShadow: '0 20px 50px -25px rgba(15,23,42,.2)' }}>
              <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: `${C.primary}12`, color: C.primary, fontSize: 13, fontWeight: 700 }}><Wallet size={14} /> Pricing</span>
              <h2 style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 800, letterSpacing: '-.025em', marginTop: 18 }}>Pricing Coming Soon</h2>
              <p style={{ color: C.muted, fontSize: 17, lineHeight: 1.6, marginTop: 14 }}>
                StockBolt is currently <strong style={{ color: C.text }}>free during launch</strong>.<br />Monthly and yearly plans are coming soon.
              </p>
              <Link to="/register" className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-base font-semibold text-white transition-transform hover:-translate-y-0.5" style={{ background: GRAD, marginTop: 28, boxShadow: '0 14px 30px -8px rgba(109,40,217,.55)' }}>
                Get Early Access <ArrowRight size={18} />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section id="faq" style={{ paddingBottom: 90 }}>
        <div className="mx-auto px-5 md:px-8" style={{ maxWidth: 760 }}>
          <Reveal>
            <h2 style={{ textAlign: 'center', fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 800, letterSpacing: '-.025em', marginBottom: 36 }}>Frequently asked questions</h2>
          </Reveal>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {FAQS.map((f, i) => {
              const open = faqOpen === i;
              return (
                <Reveal key={i} delay={i * 0.04}>
                  <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden' }}>
                    <button onClick={() => setFaqOpen(open ? null : i)} className="flex w-full items-center justify-between gap-4 text-left" style={{ padding: '18px 22px', cursor: 'pointer', background: 'transparent', border: 'none' }}>
                      <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>{f.q}</span>
                      <ChevronDown size={20} color={C.muted} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .25s', flexShrink: 0 }} />
                    </button>
                    <motion.div initial={false} animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }} transition={{ duration: 0.28, ease: 'easeInOut' }} style={{ overflow: 'hidden' }}>
                      <p style={{ padding: '0 22px 20px', color: C.muted, fontSize: 15, lineHeight: 1.65 }}>{f.a}</p>
                    </motion.div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section style={{ paddingBottom: 90 }}>
        <div className="mx-auto px-5 md:px-8" style={{ maxWidth: 1100 }}>
          <Reveal>
            <div style={{ position: 'relative', textAlign: 'center', background: GRAD, borderRadius: 32, padding: 'clamp(48px, 7vw, 84px) 28px', overflow: 'hidden', boxShadow: '0 40px 80px -30px rgba(109,40,217,.55)' }}>
              <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,.18), transparent 50%)' }} />
              <h2 style={{ position: 'relative', fontSize: 'clamp(28px, 4.5vw, 46px)', fontWeight: 800, color: '#fff', letterSpacing: '-.025em', lineHeight: 1.1 }}>
                Run your entire parts business from one system.
              </h2>
              <p style={{ position: 'relative', color: 'rgba(255,255,255,.9)', fontSize: 18, lineHeight: 1.6, marginTop: 18, maxWidth: 600, marginInline: 'auto' }}>
                Inventory, accounting, customers and sales — built specifically for auto parts businesses.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3" style={{ position: 'relative', marginTop: 32 }}>
                <Link to="/register" className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-base font-semibold transition-transform hover:-translate-y-0.5" style={{ background: '#fff', color: C.primary, boxShadow: '0 12px 28px -8px rgba(0,0,0,.3)' }}>
                  Start Free <ArrowRight size={18} />
                </Link>
                <a href="mailto:sales@stockbolt.com?subject=StockBolt%20Demo" className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-base font-semibold text-white transition-colors" style={{ border: '1px solid rgba(255,255,255,.5)' }}>
                  Book Demo
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: `1px solid ${C.border}`, background: '#fff' }}>
        <div className="mx-auto grid gap-8 px-5 md:px-8 md:grid-cols-2" style={{ maxWidth: 1100, paddingTop: 48, paddingBottom: 40 }}>
          <div>
            <BrandLogo mark={28} text={15} />
            <p style={{ color: C.text, fontSize: 15, fontWeight: 600, marginTop: 16 }}>Inventory. Accounting. Sales.</p>
            <p style={{ color: C.muted, fontSize: 14, marginTop: 6, maxWidth: 320, lineHeight: 1.6 }}>Made for modern auto parts businesses.</p>
          </div>
          <div className="flex gap-16 md:justify-end" style={{ fontSize: 14 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>Product</div>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 9, color: C.muted }}>
                <li><a href="#features" className="hover:text-slate-900">Features</a></li>
                <li><a href="#pricing" className="hover:text-slate-900">Pricing</a></li>
                <li><a href="mailto:sales@stockbolt.com" className="hover:text-slate-900">Contact</a></li>
                <li><Link to="/privacy" className="hover:text-slate-900">Privacy Policy</Link></li>
              </ul>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>Account</div>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 9, color: C.muted }}>
                <li><Link to="/register" className="hover:text-slate-900">Start Free</Link></li>
                <li><Link to="/login" className="hover:text-slate-900">Sign in</Link></li>
              </ul>
            </div>
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          <div className="mx-auto px-5 md:px-8" style={{ maxWidth: 1100, padding: '18px 0', fontSize: 13, color: C.muted, textAlign: 'center' }}>
            © {new Date().getFullYear()} StockBolt ERP. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
