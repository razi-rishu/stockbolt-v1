/**
 * Landing page — StockBolt marketing site (2026-07 redesign).
 *
 * Public page at `/` (anonymous) and `/landing`. Navy / blue / teal palette
 * per the approved mock: sticky nav, hero with CSS-built dashboard + phone
 * mockups, trusted-brands strip, 6-feature grid, industries band, navy stats
 * bar, free-trial pricing card, gradient CTA and a 5-column footer.
 *
 * The brand mark renders in teal here (marketing palette per the mock); the
 * app itself uses the default orange mark.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion, type Variants } from 'framer-motion';
import {
  ArrowRight, PlayCircle, CheckCircle2, ChevronDown, Menu, X,
  ShoppingCart, Package, ShoppingBag, Calculator, Users, BarChart3,
  Store, Truck, Globe, Wrench, Building2, FileText, ShieldCheck,
  Rocket, Cog, Send,
} from 'lucide-react';
import { BrandMark } from '@/components/brand-logo';

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  navy:   '#0A2540',
  ink:    '#0F2747',
  text:   '#334155',
  muted:  '#64748B',
  faint:  '#94A3B8',
  border: '#E2E8F0',
  bg:     '#F4F8FC',
  card:   '#FFFFFF',
  blue:   '#2563EB',
  teal:   '#0EA5A4',
  green:  '#10B981',
};
const TEAL_MARK = '#0EA5A4';
const DEMO_MAILTO = 'mailto:sales@stockbolt.com?subject=StockBolt%20Demo';

// ── Shared bits ──────────────────────────────────────────────────────────────
function Reveal({ children, delay = 0, className = '', style }: { children: ReactNode; delay?: number; className?: string; style?: CSSProperties }) {
  const variants: Variants = {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: 'easeOut', delay } },
  };
  return (
    <motion.div
      className={className}
      style={style}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-60px' }}
    >
      {children}
    </motion.div>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.blue, letterSpacing: '.01em' }}>{children}</p>
  );
}

function H2({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ margin: '8px 0 0', fontSize: 'clamp(26px, 3.4vw, 34px)', fontWeight: 800, letterSpacing: '-.02em', color: C.ink }}>
      {children}
    </h2>
  );
}

function BrandRow({ text = 15, tone = C.ink }: { text?: number; tone?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
      <BrandMark size={Math.round(text * 1.9)} color={TEAL_MARK} />
      <span style={{ fontSize: text, fontWeight: 800, letterSpacing: '0.1em', color: tone, lineHeight: 1 }}>STOCKBOLT</span>
    </span>
  );
}

// ── Nav ──────────────────────────────────────────────────────────────────────
function NavDrop({ label, items }: { label: string; items: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 500, color: C.text, padding: '6px 2px' }}
      >
        {label} <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', insetInlineStart: 0, minWidth: 210, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 16px 40px -12px rgba(15,39,71,.18)', padding: '6px 0', zIndex: 60 }}>
          {items.map((it) => (
            <a key={it.label} href={it.href} onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '8px 16px', fontSize: 13.5, color: C.text, textDecoration: 'none' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = C.bg; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >{it.label}</a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Hero mockups (pure CSS/SVG — no images) ─────────────────────────────────
function MiniKpi({ label, value, delta, color }: { label: string; value: string; delta: string; color: string }) {
  return (
    <div style={{ flex: '1 1 110px', minWidth: 0, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 9.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 13, fontWeight: 800, color: C.ink, whiteSpace: 'nowrap' }}>{value}</div>
      <div style={{ marginTop: 2, fontSize: 9.5, fontWeight: 700, color }}>{delta}</div>
    </div>
  );
}

function DashboardMock() {
  const menu = ['Dashboard', 'Sales', 'Purchasing', 'Inventory', 'Accounting', 'Reports', 'Payroll', 'Suppliers', 'Customers', 'Settings'];
  const parts = [['Oil Filter', '1,250'], ['Brake Pad', '980'], ['Air Filter', '875'], ['Spark Plug', '650']];
  return (
    <div style={{ background: '#fff', borderRadius: 18, border: `1px solid ${C.border}`, boxShadow: '0 40px 80px -24px rgba(15,39,71,.28)', overflow: 'hidden', display: 'flex', minHeight: 340 }}>
      {/* sidebar */}
      <div style={{ width: 132, borderInlineEnd: `1px solid ${C.border}`, padding: '14px 10px', flexShrink: 0 }} className="hidden sm:block">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingInlineStart: 4, marginBottom: 14 }}>
          <BrandMark size={18} color={TEAL_MARK} />
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', color: C.ink }}>STOCKBOLT</span>
        </div>
        {menu.map((m, i) => (
          <div key={m} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 8, marginBottom: 1,
            background: i === 0 ? '#EAF1FE' : 'transparent',
            color: i === 0 ? C.blue : C.muted, fontSize: 10.5, fontWeight: i === 0 ? 700 : 500,
          }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, border: `1.4px solid currentColor`, opacity: .75 }} />
            {m}
          </div>
        ))}
      </div>
      {/* main */}
      <div style={{ flex: 1, minWidth: 0, padding: '14px 16px', background: '#FAFCFF' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>Dashboard</span>
          <span style={{ display: 'flex', gap: 6 }}>
            {[0, 1, 2].map((i) => <span key={i} style={{ width: 18, height: 18, borderRadius: 6, border: `1px solid ${C.border}`, background: '#fff' }} />)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <MiniKpi label="Total Sales" value="AED 1,806.66" delta="▲ +12.5%" color={C.green} />
          <MiniKpi label="Purchases" value="AED 1,589.00" delta="▲ +8.2%" color={C.blue} />
          <MiniKpi label="Inventory Value" value="AED 245,320" delta="▲ +10.4%" color={C.teal} />
          <MiniKpi label="Total Profit" value="AED 216.32" delta="▲ +15.6%" color={C.green} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
          {/* chart */}
          <div style={{ flex: '2 1 240px', minWidth: 0, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.ink }}>Sales Overview</span>
              <span style={{ fontSize: 9, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 999, padding: '2px 8px' }}>This Year ▾</span>
            </div>
            <svg viewBox="0 0 360 110" style={{ width: '100%', height: 'auto', display: 'block' }} aria-hidden="true">
              <defs>
                <linearGradient id="lpFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.blue} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={C.blue} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[22, 44, 66, 88].map((y) => <line key={y} x1="0" x2="360" y1={y} y2={y} stroke={C.border} strokeDasharray="3 4" strokeWidth="1" />)}
              <path d="M0,95 C30,88 45,70 70,72 C95,74 108,50 135,52 C160,54 172,78 200,72 C228,66 238,30 265,32 C288,34 300,55 322,48 C338,43 350,30 360,26" fill="none" stroke={C.blue} strokeWidth="2.5" strokeLinecap="round" />
              <path d="M0,95 C30,88 45,70 70,72 C95,74 108,50 135,52 C160,54 172,78 200,72 C228,66 238,30 265,32 C288,34 300,55 322,48 C338,43 350,30 360,26 L360,110 L0,110 Z" fill="url(#lpFill)" />
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8.5, color: C.faint, marginTop: 4 }}>
              {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'].map((m) => <span key={m}>{m}</span>)}
            </div>
          </div>
          {/* top parts */}
          <div style={{ flex: '1 1 130px', minWidth: 0, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 8 }}>Top Selling Parts</div>
            {parts.map(([name, qty]) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 0', borderTop: `1px solid ${C.bg}` }}>
                <span style={{ width: 20, height: 20, borderRadius: 6, background: '#EAF1FE', color: C.blue, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Cog size={11} />
                </span>
                <span style={{ flex: 1, fontSize: 10, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.ink }}>{qty}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneMock() {
  return (
    <div style={{ width: 172, background: '#fff', borderRadius: 22, border: `1px solid ${C.border}`, boxShadow: '0 30px 60px -18px rgba(15,39,71,.35)', padding: '12px 12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 9, color: C.faint }}>‹</span>
        <span style={{ display: 'flex', gap: 3 }}>
          {[0, 1, 2].map((i) => <span key={i} style={{ width: 4, height: 4, borderRadius: 999, background: C.border }} />)}
        </span>
      </div>
      <div style={{ fontSize: 8.5, color: C.muted }}>Good Morning,</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, marginBottom: 8 }}>Admin</div>
      <div style={{ fontSize: 8.5, fontWeight: 700, color: C.muted, marginBottom: 5 }}>Today's Overview</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 9 }}>
        {[
          ['Sales', 'AED 1,806.66', C.green], ['Purchases', 'AED 1,589.00', C.blue],
          ['Invoices', '24', C.teal], ['Low Stock', '12', '#DC2626'],
        ].map(([l, v, col]) => (
          <div key={l as string} style={{ background: '#F8FBFF', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 7px' }}>
            <div style={{ fontSize: 7.5, color: col as string, fontWeight: 700 }}>{l}</div>
            <div style={{ fontSize: 9.5, fontWeight: 800, color: C.ink, whiteSpace: 'nowrap' }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 8.5, fontWeight: 700, color: C.muted }}>Recent Activity</span>
        <span style={{ fontSize: 8, color: C.blue, fontWeight: 600 }}>View all</span>
      </div>
      {[
        ['Invoice #INV-00124', '2 mins ago', 'AED 850.00'],
        ['Purchase #PO-00056', '1 hour ago', 'AED 1,250.00'],
      ].map(([title, when, amt]) => (
        <div key={title} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderTop: `1px solid ${C.bg}` }}>
          <span style={{ width: 16, height: 16, borderRadius: 5, background: '#E7F8F1', color: C.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <FileText size={9} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 8, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
            <span style={{ display: 'block', fontSize: 7, color: C.faint }}>{when}</span>
          </span>
          <span style={{ fontSize: 8, fontWeight: 800, color: C.ink, whiteSpace: 'nowrap' }}>{amt}</span>
        </div>
      ))}
    </div>
  );
}

// ── Data ─────────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: ShoppingCart, tint: '#E7F8F1', color: C.green,  title: 'Sales Management',   text: 'Create invoices, manage customers, track sales and quotes effortlessly.' },
  { icon: Package,      tint: '#F1EDFE', color: '#7C3AED', title: 'Inventory Control',  text: 'Real-time stock tracking, multi-warehouse management and low stock alerts.' },
  { icon: ShoppingBag,  tint: '#F1EDFE', color: '#7C3AED', title: 'Purchasing',         text: 'Manage suppliers, purchase orders, receipts and vendor bills.' },
  { icon: Calculator,   tint: '#FEF3E7', color: '#EA580C', title: 'Accounting',         text: 'Powerful accounting with reports, P&L, balance sheet and cash flow.' },
  { icon: Users,        tint: '#EAF1FE', color: C.blue,   title: 'Multi-User Access',  text: 'Role-based access control for your team with complete data security.' },
  { icon: BarChart3,    tint: '#E7F8F1', color: C.green,  title: 'Reports & Analytics', text: 'Beautiful insights and custom reports to help your business grow faster.' },
];

const INDUSTRIES = [
  { icon: Store,     label: 'Auto Parts Retailers' },
  { icon: Truck,     label: 'Parts Distributors' },
  { icon: Globe,     label: 'Importers & Exporters' },
  { icon: Wrench,    label: 'Workshops & Garages' },
  { icon: Building2, label: 'Multi-Branch Businesses' },
  { icon: ShoppingBag, label: 'E-commerce Sellers' },
];

const STATS = [
  { icon: Users,       tint: C.teal,  value: '10K+',  label: 'Active Users' },
  { icon: FileText,    tint: C.blue,  value: '50K+',  label: 'Invoices Generated' },
  { icon: Package,     tint: '#7C3AED', value: '1M+', label: 'Parts Managed' },
  { icon: ShieldCheck, tint: C.green, value: '99.9%', label: 'Uptime & Security' },
];

const TRUSTED = ['BOSCH', 'DENSO', 'MAHLE', 'AISIN', 'MANN FILTER', 'NGK', 'WÜRTH', 'Valeo'];

const TRIAL_CHECKS = ['All Modules Included', 'No Time Limit Restrictions', 'Priority Support', 'Easy Setup'];

// ── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [newsletterEmail, setNewsletterEmail] = useState('');

  // Lightweight SEO — title + description (no react-helmet dependency).
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'StockBolt ERP — Inventory & Accounting for Auto Parts Businesses';
    const meta = document.querySelector('meta[name="description"]') ?? (() => {
      const m = document.createElement('meta'); m.setAttribute('name', 'description'); document.head.appendChild(m); return m;
    })();
    const prevDesc = meta.getAttribute('content');
    meta.setAttribute('content', 'StockBolt is the all-in-one ERP for auto parts businesses — sales, inventory, purchasing and accounting in one powerful system. VAT-ready, Arabic support, cloud based.');
    return () => { document.title = prevTitle; if (prevDesc) meta.setAttribute('content', prevDesc); };
  }, []);

  const navLinks = (
    <>
      <NavDrop label="Features" items={FEATURES.map((f) => ({ label: f.title, href: '#features' }))} />
      <a href="#features" style={{ fontSize: 14, fontWeight: 500, color: C.text, textDecoration: 'none', padding: '6px 2px' }}>Modules</a>
      <NavDrop label="Industries" items={INDUSTRIES.map((i) => ({ label: i.label, href: '#industries' }))} />
      <a href="#pricing" style={{ fontSize: 14, fontWeight: 500, color: C.text, textDecoration: 'none', padding: '6px 2px' }}>Pricing</a>
      <NavDrop label="Resources" items={[
        { label: 'Documentation', href: DEMO_MAILTO },
        { label: 'Help Center', href: 'mailto:support@stockbolt.com' },
        { label: 'Contact Us', href: DEMO_MAILTO },
      ]} />
    </>
  );

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif', overflowX: 'hidden' }}>
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(244,248,252,0.82)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: `1px solid ${C.border}` }}>
        <nav className="mx-auto flex items-center justify-between gap-4 px-5 md:px-8" style={{ maxWidth: 1240, height: 66 }}>
          <Link to="/" aria-label="StockBolt home" style={{ textDecoration: 'none', flexShrink: 0 }}>
            <BrandRow text={15} />
          </Link>
          <div className="hidden items-center gap-7 lg:flex">{navLinks}</div>
          <div className="hidden items-center gap-3 lg:flex" style={{ flexShrink: 0 }}>
            <Link to="/login" style={{ padding: '9px 20px', borderRadius: 10, border: `1px solid ${C.border}`, background: '#fff', color: C.ink, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Log in</Link>
            <Link to="/register" style={{ padding: '9px 20px', borderRadius: 10, background: C.navy, color: '#fff', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Get Started</Link>
          </div>
          <button type="button" aria-label="Menu" onClick={() => setMobileOpen((o) => !o)} className="lg:hidden" style={{ background: 'none', border: 'none', color: C.ink, cursor: 'pointer' }}>
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </nav>
        {mobileOpen && (
          <div className="lg:hidden" style={{ borderTop: `1px solid ${C.border}`, background: '#fff', padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <a href="#features" onClick={() => setMobileOpen(false)} style={{ color: C.text, textDecoration: 'none', fontSize: 15, fontWeight: 500 }}>Features</a>
            <a href="#industries" onClick={() => setMobileOpen(false)} style={{ color: C.text, textDecoration: 'none', fontSize: 15, fontWeight: 500 }}>Industries</a>
            <a href="#pricing" onClick={() => setMobileOpen(false)} style={{ color: C.text, textDecoration: 'none', fontSize: 15, fontWeight: 500 }}>Pricing</a>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <Link to="/login" style={{ flex: 1, textAlign: 'center', padding: '10px 0', borderRadius: 10, border: `1px solid ${C.border}`, color: C.ink, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Log in</Link>
              <Link to="/register" style={{ flex: 1, textAlign: 'center', padding: '10px 0', borderRadius: 10, background: C.navy, color: '#fff', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Get Started</Link>
            </div>
          </div>
        )}
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section style={{ position: 'relative', overflow: 'hidden' }}>
        {/* soft background washes */}
        <div aria-hidden="true" style={{ position: 'absolute', top: -120, insetInlineStart: -120, width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(16,185,129,.10), transparent 65%)' }} />
        <div aria-hidden="true" style={{ position: 'absolute', top: -80, insetInlineEnd: -100, width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle, rgba(37,99,235,.12), transparent 65%)' }} />
        <div className="mx-auto grid items-center gap-12 px-5 md:px-8 lg:grid-cols-2" style={{ maxWidth: 1240, paddingTop: 64, paddingBottom: 80, position: 'relative' }}>
          <Reveal>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#E7F8F1', color: '#047857', borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 700 }}>
              ⚡ Smart ERP for Auto Parts Businesses
            </span>
            <h1 style={{ margin: '22px 0 0', fontSize: 'clamp(34px, 4.6vw, 52px)', lineHeight: 1.12, fontWeight: 800, letterSpacing: '-.025em', color: C.ink }}>
              Run Your Auto Parts Business <span style={{ color: C.blue }}>Smarter,</span><br />
              Faster, <span style={{ color: C.teal }}>Better.</span>
            </h1>
            <p style={{ margin: '20px 0 0', fontSize: 17, lineHeight: 1.65, color: C.muted, maxWidth: 460 }}>
              StockBolt is an all-in-one ERP platform that helps you manage sales, inventory, purchasing, accounting and more — in one powerful system.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 30 }}>
              <Link to="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 26px', borderRadius: 12, background: C.navy, color: '#fff', fontSize: 15, fontWeight: 700, textDecoration: 'none', boxShadow: '0 14px 30px -10px rgba(10,37,64,.45)' }}>
                Start 365-Day Free Trial <ArrowRight size={17} />
              </Link>
              <a href={DEMO_MAILTO} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 24px', borderRadius: 12, border: `1px solid ${C.border}`, background: '#fff', color: C.ink, fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>
                <PlayCircle size={17} /> Book a Demo
              </a>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, marginTop: 26 }}>
              {['No Credit Card', 'Full Access', 'Easy Setup'].map((c) => (
                <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 600, color: C.text }}>
                  <CheckCircle2 size={16} color={C.green} /> {c}
                </span>
              ))}
            </div>
          </Reveal>

          <Reveal delay={0.15}>
            <div style={{ position: 'relative', paddingBottom: 70 }}>
              <DashboardMock />
              <div className="hidden sm:block" style={{ position: 'absolute', bottom: 0, insetInlineEnd: -8 }}>
                <PhoneMock />
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Trusted brands strip ────────────────────────────────────────── */}
      <section style={{ background: '#fff', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div className="mx-auto px-5 md:px-8" style={{ maxWidth: 1240, paddingTop: 30, paddingBottom: 34 }}>
          <p style={{ margin: 0, textAlign: 'center', fontSize: 13, color: C.muted }}>
            Trusted by auto parts businesses across the region
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '18px 44px', marginTop: 18 }}>
            {TRUSTED.map((b) => (
              <span key={b} style={{ fontSize: 17, fontWeight: 800, letterSpacing: '.04em', color: '#9AA6B5' }}>{b}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section id="features" style={{ paddingTop: 80, paddingBottom: 40 }}>
        <div className="mx-auto px-5 md:px-8" style={{ maxWidth: 1240 }}>
          <Reveal style={{ textAlign: 'center' }}>
            <Kicker>Everything You Need</Kicker>
            <H2>Powerful Features. All in One Place.</H2>
          </Reveal>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" style={{ marginTop: 44 }}>
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 0.05}>
                <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16, padding: '26px 20px', height: '100%', transition: 'box-shadow .2s, transform .2s' }}
                  onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = '0 18px 40px -16px rgba(15,39,71,.16)'; el.style.transform = 'translateY(-3px)'; }}
                  onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = 'none'; el.style.transform = 'none'; }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 999, background: f.tint, color: f.color, marginBottom: 16 }}>
                    <f.icon size={24} />
                  </span>
                  <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: C.ink }}>{f.title}</h3>
                  <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.6, color: C.muted }}>{f.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Industries ──────────────────────────────────────────────────── */}
      <section id="industries" style={{ paddingTop: 50, paddingBottom: 70 }}>
        <div className="mx-auto grid items-center gap-10 px-5 md:px-8 lg:grid-cols-[1fr_1.4fr]" style={{ maxWidth: 1240 }}>
          <Reveal>
            <Kicker>Built for Every Auto Parts Business</Kicker>
            <H2>One Solution.<br />Many Possibilities.</H2>
            <p style={{ margin: '16px 0 0', fontSize: 15, lineHeight: 1.7, color: C.muted, maxWidth: 380 }}>
              Whether you're a parts store, distributor, importer, workshop or online seller, StockBolt fits your business perfectly.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <div style={{ position: 'relative' }}>
              <div aria-hidden="true" style={{ position: 'absolute', top: -30, insetInlineEnd: -20, width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(37,99,235,.10), transparent 70%)' }} />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6" style={{ position: 'relative' }}>
                {INDUSTRIES.map((ind) => (
                  <div key={ind.label} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 10px', textAlign: 'center' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 12, background: '#EAF1FE', color: C.blue, marginBottom: 10 }}>
                      <ind.icon size={21} />
                    </span>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, lineHeight: 1.35, color: C.text }}>{ind.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Stats band ──────────────────────────────────────────────────── */}
      <section className="px-5 md:px-8">
        <Reveal className="mx-auto" style={{ maxWidth: 1240 }}>
          <div className="grid grid-cols-2 gap-8 lg:grid-cols-4" style={{ background: C.navy, borderRadius: 24, padding: '38px 30px' }}>
            {STATS.map((s) => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: 999, background: 'rgba(255,255,255,.10)', color: s.tint, flexShrink: 0 }}>
                  <s.icon size={22} />
                </span>
                <span>
                  <span style={{ display: 'block', fontSize: 24, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>{s.value}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: 'rgba(255,255,255,.65)' }}>{s.label}</span>
                </span>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <section id="pricing" className="px-5 md:px-8" style={{ paddingTop: 60, paddingBottom: 30 }}>
        <Reveal className="mx-auto" style={{ maxWidth: 1240 }}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 24, padding: '36px 34px' }}>
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <Kicker>Simple &amp; Transparent</Kicker>
                <H2>Start Free. Upgrade Anytime.</H2>
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {TRIAL_CHECKS.map((c) => (
                  <li key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, color: C.text }}>
                    <CheckCircle2 size={16} color={C.teal} /> {c}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-7 flex flex-wrap items-center justify-between gap-6" style={{ background: '#F8FBFF', border: `1px solid ${C.border}`, borderRadius: 18, padding: '24px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 54, height: 54, borderRadius: 999, background: '#EAF1FE', color: C.blue }}>
                  <Rocket size={25} />
                </span>
                <span>
                  <span style={{ display: 'block', fontSize: 19, fontWeight: 800, color: C.ink }}>365-Day Free Trial</span>
                  <span style={{ display: 'block', fontSize: 13.5, color: C.muted }}>All features. Full access.</span>
                </span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.ink, verticalAlign: 'top' }}>AED</span>
                <span style={{ fontSize: 42, fontWeight: 800, color: C.ink, lineHeight: 1, marginInlineStart: 6 }}>0</span>
                <span style={{ display: 'block', fontSize: 12.5, color: C.muted, marginTop: 2 }}>No credit card required</span>
              </div>
              <Link to="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 26px', borderRadius: 12, background: C.blue, color: '#fff', fontSize: 15, fontWeight: 700, textDecoration: 'none', boxShadow: '0 12px 26px -10px rgba(37,99,235,.55)' }}>
                Start Free Trial <ArrowRight size={17} />
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── CTA band ────────────────────────────────────────────────────── */}
      <section className="px-5 md:px-8" style={{ paddingTop: 30, paddingBottom: 70 }}>
        <Reveal className="mx-auto" style={{ maxWidth: 1240 }}>
          <div className="flex flex-wrap items-center justify-between gap-8" style={{ background: `linear-gradient(100deg, ${C.navy} 0%, #0E4A64 55%, ${C.green} 130%)`, borderRadius: 24, padding: '40px 38px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, minWidth: 0 }}>
              <span className="hidden sm:inline-flex" style={{ alignItems: 'center', justifyContent: 'center', width: 74, height: 74, borderRadius: 999, background: 'rgba(255,255,255,.10)', flexShrink: 0 }}>
                <BrandMark size={42} color={C.green} />
              </span>
              <span>
                <span style={{ display: 'block', fontSize: 'clamp(22px, 2.6vw, 28px)', fontWeight: 800, color: '#fff', letterSpacing: '-.01em', lineHeight: 1.25 }}>
                  Ready to Transform<br />Your Auto Parts Business?
                </span>
                <span style={{ display: 'block', marginTop: 8, fontSize: 14, color: 'rgba(255,255,255,.75)', maxWidth: 430 }}>
                  Join the businesses already using StockBolt to simplify operations and grow faster.
                </span>
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <Link to="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 24px', borderRadius: 12, background: '#fff', color: C.navy, fontSize: 15, fontWeight: 700, textDecoration: 'none' }}>
                Start 365-Day Free Trial <ArrowRight size={17} />
              </Link>
              <a href={DEMO_MAILTO} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 22px', borderRadius: 12, border: '1px solid rgba(255,255,255,.4)', color: '#fff', fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>
                <PlayCircle size={17} /> Book a Demo
              </a>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer style={{ background: '#fff', borderTop: `1px solid ${C.border}` }}>
        <div className="mx-auto grid gap-10 px-5 md:px-8 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.3fr]" style={{ maxWidth: 1240, paddingTop: 52, paddingBottom: 40 }}>
          <div>
            <BrandRow text={14} />
            <p style={{ margin: '14px 0 0', fontSize: 13.5, lineHeight: 1.6, color: C.muted, maxWidth: 220 }}>
              The complete ERP solution for auto parts businesses.
            </p>
          </div>
          {([
            ['Product', [
              ['Features', '#features'], ['Modules', '#features'], ['Pricing', '#pricing'],
            ]],
            ['Company', [
              ['About Us', DEMO_MAILTO], ['Partners', DEMO_MAILTO], ['Contact Us', DEMO_MAILTO],
            ]],
            ['Resources', [
              ['Documentation', 'mailto:support@stockbolt.com'], ['Help Center', 'mailto:support@stockbolt.com'], ['Book a Demo', DEMO_MAILTO],
            ]],
          ] as [string, [string, string][]][]).map(([title, links]) => (
            <div key={title} style={{ fontSize: 13.5 }}>
              <p style={{ margin: '0 0 12px', fontWeight: 700, color: C.ink }}>{title}</p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                {links.map(([label, href]) => (
                  <li key={label}>
                    <a href={href} style={{ color: C.muted, textDecoration: 'none' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = C.ink; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = C.muted; }}
                    >{label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div style={{ fontSize: 13.5 }}>
            <p style={{ margin: '0 0 12px', fontWeight: 700, color: C.ink }}>Stay Updated</p>
            <p style={{ margin: '0 0 12px', color: C.muted }}>Subscribe to get the latest updates and insights.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                window.location.href = `mailto:sales@stockbolt.com?subject=Subscribe%20to%20StockBolt%20updates&body=${encodeURIComponent(newsletterEmail)}`;
              }}
              style={{ display: 'flex', gap: 0 }}
            >
              <input
                type="email"
                required
                value={newsletterEmail}
                onChange={(e) => setNewsletterEmail(e.target.value)}
                placeholder="Enter your email"
                style={{ flex: 1, minWidth: 0, height: 42, border: `1px solid ${C.border}`, borderStartStartRadius: 10, borderEndStartRadius: 10, borderStartEndRadius: 0, borderEndEndRadius: 0, padding: '0 12px', fontSize: 13.5, outline: 'none', background: '#F8FBFF', color: C.ink }}
              />
              <button type="submit" aria-label="Subscribe" style={{ height: 42, width: 46, border: 'none', borderStartEndRadius: 10, borderEndEndRadius: 10, background: C.teal, color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          <div className="mx-auto flex flex-wrap items-center justify-between gap-3 px-5 md:px-8" style={{ maxWidth: 1240, paddingTop: 18, paddingBottom: 18, fontSize: 12.5, color: C.muted }}>
            <span>© {new Date().getFullYear()} StockBolt. All rights reserved.</span>
            <span style={{ display: 'flex', gap: 22 }}>
              <a href={DEMO_MAILTO} style={{ color: C.muted, textDecoration: 'none' }}>Privacy Policy</a>
              <a href={DEMO_MAILTO} style={{ color: C.muted, textDecoration: 'none' }}>Terms of Service</a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
