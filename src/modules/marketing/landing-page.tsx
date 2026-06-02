/**
 * Landing page — Phase 14.14c.
 *
 * Public marketing page that lives at `/` (for anonymous visitors) and
 * `/landing` (always reachable). Logged-in users hitting `/` are bounced
 * to `/dashboard` via the route layer; this component itself just
 * renders the marketing content.
 *
 * Source-of-truth note: the standalone static landing/index.html still
 * exists for hosting the marketing site on a different subdomain
 * (e.g. stockbolt.com vs app.stockbolt.com). Keep the two in rough sync
 * if marketing copy changes — this React version is what loads in-app.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import './landing-page.css';

interface FeatureProps { icon: React.ReactNode; title: string; body: string; }
function Feature({ icon, title, body }: FeatureProps) {
  return (
    <div className="lp-feature">
      <div className="lp-feature-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

interface FaqItemProps { question: string; answer: string; }
function FaqItem({ question, answer, isOpen, onClick }: FaqItemProps & { isOpen: boolean; onClick: () => void }) {
  return (
    <div className={`lp-faq-item ${isOpen ? 'lp-open' : ''}`}>
      <button className="lp-faq-q" onClick={onClick} aria-expanded={isOpen}>
        <span>{question}</span>
        <svg className="lp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div className="lp-faq-a">{answer}</div>
    </div>
  );
}

const FAQS: FaqItemProps[] = [
  { question: 'Do you actually support Arabic, or is it Google Translate?',
    answer:   'Full bilingual support, baked in from day one. Every screen flips to RTL with one click. Products, contacts, and account names carry both English and Arabic variants. Printed invoices and statements render correctly in either language — including Arabic numerals if you want them.' },
  { question: 'Which countries are you really built for?',
    answer:   'UAE, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman, and India. Each country gets its own VAT/GST configuration, currency, and fiscal-year defaults. You pick your country during onboarding and the rest is wired correctly automatically.' },
  { question: 'Can I move my data over from Tally / Excel / my old system?',
    answer:   'Yes. There’s a built-in CSV/XLSX import for products, customers, suppliers, opening stock, tax rates, brands, categories, and even opening balances. Plus a proper opening-balance wizard that books your old AR, AP, advances, bank balances, and capital against Opening Balance Equity — the way an accountant expects.' },
  { question: 'What about VAT or GST returns?',
    answer:   'There’s a built-in VAT report that reconciles output VAT (from invoices) against input VAT (from bills), with the working-capital impact reflected in the cash-flow report. For India, GST input/output is captured per line so you can hand off to your CA cleanly. e-Invoice integration is on the roadmap.' },
  { question: 'Does it run multiple warehouses?',
    answer:   'Yes — unlimited warehouses with proper stock transfers between them. Each warehouse tracks its own stock and you can see per-warehouse availability on every invoice line. Aisle and bin locations are stored per product, so finding stock on the floor takes seconds.' },
  { question: 'Is there a mobile app?',
    answer:   'The web app is fully responsive and works on any phone or tablet browser. A dedicated native app is on the roadmap for offline counter sales and barcode scanning.' },
  { question: 'Who exactly is this for?',
    answer:   'Auto-parts retailers, wholesalers, distributors, and workshops with parts counters. Anywhere from a one-counter shop up to a small chain with three or four warehouses. If your day involves quoting parts to walk-ins, managing supplier credit, and chasing customer balances — this is for you.' },
];

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="lp">

      {/* ── NAV ──────────────────────────────────────────────────────── */}
      <nav className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <Link to="/" className="lp-logo" aria-label="StockBolt home">
            <span className="lp-logo-mark">
              <svg viewBox="0 0 24 24" fill="white" aria-hidden="true">
                <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
              </svg>
            </span>
            StockBolt
          </Link>
          <div className="lp-nav-links">
            <a href="#features" className="lp-nav-link">Features</a>
            <a href="#auto-parts" className="lp-nav-link">For auto parts</a>
            <a href="#faq" className="lp-nav-link">FAQ</a>
          </div>
          <div className="lp-nav-cta">
            <Link to="/login" className="lp-btn lp-btn-ghost">Sign in</Link>
            <Link to="/register" className="lp-btn lp-btn-indigo">
              Start free <span className="lp-arrow">→</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <header className="lp-hero">
        <div className="lp-container lp-hero-inner">
          <div className="lp-eyebrow">
            <span className="lp-dot" />
            Live beta · Built for the GCC and India
          </div>
          <h1>
            The auto-parts ERP,<br />
            <span className="lp-accent">finally built</span> for how you actually work.
          </h1>
          <p className="lp-hero-sub">
            Inventory, accounting, customers, suppliers — bilingual, VAT-ready, and
            designed from scratch for the parts trade. Not a generic ERP with auto-parts
            bolted on.
          </p>
          <div className="lp-hero-cta">
            <Link to="/register" className="lp-btn lp-btn-indigo lp-btn-lg">
              Start free <span className="lp-arrow">→</span>
            </Link>
            <a href="#features" className="lp-btn lp-btn-ghost lp-btn-lg">See what's inside</a>
          </div>
          <div className="lp-hero-foot">
            <span><span className="lp-check">✓</span> No credit card required</span>
            <span><span className="lp-check">✓</span> 5-minute setup</span>
            <span><span className="lp-check">✓</span> Bilingual EN / AR</span>
          </div>
        </div>
      </header>

      {/* ── TRUST STRIP ──────────────────────────────────────────────── */}
      <section className="lp-trust">
        <div className="lp-container">
          <p className="lp-trust-label">Built for the GCC and India</p>
          <div className="lp-trust-row">
            <span className="lp-country"><span className="lp-flag">🇦🇪</span> UAE</span>
            <span className="lp-country"><span className="lp-flag">🇸🇦</span> Saudi Arabia</span>
            <span className="lp-country"><span className="lp-flag">🇶🇦</span> Qatar</span>
            <span className="lp-country"><span className="lp-flag">🇰🇼</span> Kuwait</span>
            <span className="lp-country"><span className="lp-flag">🇧🇭</span> Bahrain</span>
            <span className="lp-country"><span className="lp-flag">🇴🇲</span> Oman</span>
            <span className="lp-country"><span className="lp-flag">🇮🇳</span> India</span>
          </div>
          <div className="lp-badges">
            {['UAE FTA VAT compliant', 'India GST ready', 'Arabic + RTL throughout', 'Multi-warehouse'].map((label) => (
              <span key={label} className="lp-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────────── */}
      <section id="features" className="lp-section">
        <div className="lp-container">
          <div className="lp-section-head">
            <span className="lp-section-eyebrow">Everything in one place</span>
            <h2>The full stack of a parts business.</h2>
            <p className="lp-section-sub">
              One system for stock, sales, purchasing, accounting, and reporting — all
              designed to talk to each other so you stop reconciling spreadsheets.
            </p>
          </div>

          <div className="lp-features-grid">
            <Feature
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>}
              title="Moving Average Costing"
              body="Every GRN updates landed cost in real time. Always-accurate stock valuation, not a 'we'll figure it out at year-end' guess."
            />
            <Feature
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>}
              title="Bilingual English & Arabic"
              body="Every screen, every printed invoice, every customer statement — switch with one click. Full RTL, not a fake translation overlay."
            />
            <Feature
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
              title="VAT & GST out of the box"
              body="FTA-compliant VAT for the GCC, GST-ready for India. VAT return report, tax-inclusive pricing, input/output reconciliation."
            />
            <Feature
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>}
              title="Multi-warehouse with bins"
              body="Branch warehouses, transit warehouse, and aisle/bin locations so a counter staff can find a part in seconds, not minutes."
            />
            <Feature
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
              title="Customer & supplier statements"
              body="Real-time SOA with aging, apply-credit flow, opening balances, advances — the way Tally users expect their ledgers to behave."
            />
            <Feature
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>}
              title="PDC & payment workflows"
              body="Post-dated cheques, bounced cheque handling, customer advances, vendor advances — tracked properly, not as a notes field."
            />
          </div>
        </div>
      </section>

      {/* ── AUTO PARTS DEEP DIVE ─────────────────────────────────────── */}
      <section id="auto-parts" className="lp-section lp-autoparts">
        <div className="lp-container">
          <div className="lp-autoparts-grid">
            <div>
              <span className="lp-section-eyebrow">Built for auto parts</span>
              <h2>Not a generic ERP. Designed for the parts trade.</h2>
              <p className="lp-lead">
                Auto parts is the only business StockBolt is built for. Every screen
                knows that a product has compatible vehicles, multiple supplier codes,
                a bin location, and a brand — because that's how parts shops actually sell.
              </p>
              <Link to="/register" className="lp-btn lp-btn-indigo lp-btn-lg">
                Try it free <span className="lp-arrow">→</span>
              </Link>
            </div>

            <ol className="lp-autoparts-list">
              {[
                ['01', 'Vehicle make & model compatibility',  'Tag every part with the vehicles it fits. Look up parts by Toyota Hilux 2018 or by part number — both work.'],
                ['02', 'Multiple supplier codes per part',    'The same brake pad has three different codes from three suppliers. Track all of them on one product, scan any.'],
                ['03', 'Aisle & bin locations',                '"Where is product P-1042?" Aisle 7, Bin B-3. Visible on the invoice line so the counter staff doesn\'t ask twice.'],
                ['04', 'Brand catalog & pricing tiers',        'Bosch, Mahle, Mann, Denso — brand-level reporting and per-customer pricing tiers (retail, workshop, fleet).'],
                ['05', 'Quotes, invoices, returns, credit notes', 'Walk-in quote becomes an invoice in one click. Customer returns a wrong part? Sales return + credit note, fully traced.'],
                ['06', 'Migrate your old data without faking invoices', 'Opening balances for AR, AP, advances, bank, fixed assets, capital — all bookable as proper opening entries against Opening Balance Equity.'],
              ].map(([num, title, body]) => (
                <li key={num}>
                  <span className="lp-num">{num}</span>
                  <div>
                    <h4>{title}</h4>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section id="faq" className="lp-section">
        <div className="lp-container">
          <div className="lp-section-head">
            <span className="lp-section-eyebrow">Common questions</span>
            <h2>Things you're probably wondering.</h2>
          </div>
          <div className="lp-faq-list">
            {FAQS.map((f, i) => (
              <FaqItem
                key={i}
                question={f.question}
                answer={f.answer}
                isOpen={openFaq === i}
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ─────────────────────────────────────────────────── */}
      <section className="lp-cta-banner">
        <div className="lp-container">
          <h2>Stop fighting your ERP.</h2>
          <p>Set up your shop in 5 minutes. No card, no demo call, no waiting on a sales rep.</p>
          <Link to="/register" className="lp-btn lp-btn-white lp-btn-lg">
            Start free <span className="lp-arrow">→</span>
          </Link>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-grid">
            <div>
              <Link to="/" className="lp-logo">
                <span className="lp-logo-mark">
                  <svg viewBox="0 0 24 24" fill="white" aria-hidden="true">
                    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
                  </svg>
                </span>
                StockBolt
              </Link>
              <p className="lp-footer-tag">
                The auto-parts ERP, built for the GCC and India. Bilingual, VAT-ready,
                and designed from scratch for the parts trade.
              </p>
            </div>
            <div className="lp-footer-col">
              <h5>Product</h5>
              <ul>
                <li><a href="#features">Features</a></li>
                <li><a href="#auto-parts">For auto parts</a></li>
                <li><a href="#faq">FAQ</a></li>
              </ul>
            </div>
            <div className="lp-footer-col">
              <h5>Get started</h5>
              <ul>
                <li><Link to="/register">Create account</Link></li>
                <li><Link to="/login">Sign in</Link></li>
              </ul>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>© {new Date().getFullYear()} StockBolt. All rights reserved.</span>
            <span>Made for parts shops in the GCC and India.</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
