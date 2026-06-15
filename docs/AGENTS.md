# AGENTS.md

**This is the rulebook for any AI agent (Claude Code, Cursor, etc.) working on the StockBolt codebase. Read it completely before writing any code. It is the source of truth for architecture, conventions, and process discipline.**

Last updated: When this project began (2026)
Project: StockBolt — Auto Parts ERP for GCC + India
Stack: React + Vite + TypeScript + Supabase (PostgreSQL)
Build method: Phased, sequential, documented in `docs/Document_5_Build_Phases.md`

---

## 0. THE NORTH STAR

Before anything else, internalize this:

**This codebase is a rebuild after a previous failed attempt. The previous attempt failed because:**
1. Modules were built in parallel without sequencing
2. The accounting engine was built ad-hoc per module instead of centralized
3. Cached aggregate fields (`paid_amount`, `stock_quantity`, `outstanding_balance`) drifted from the source-of-truth ledgers
4. Schema and code were inconsistent (camelCase vs snake_case, missing tables)
5. Verification invariants were never enforced

**Every rule in this document exists to prevent ONE of those failure modes from recurring.**

If you ever find yourself thinking "this rule seems like overkill, I'll just do it the simple way" — STOP. The rule exists because the simple way already broke this exact product once.

---

## 1. THE FIVE INVIOLABLE RULES

These are non-negotiable. If you cannot satisfy all five, **stop and ask the human** rather than write non-compliant code.

### Rule 1 — The General Ledger Is The Only Source Of Financial Truth

- `general_ledger` and `stock_ledger` are the ONLY sources of truth for money and stock.
- **Never** store `paid_amount`, `outstanding_balance`, `stock_quantity`, `stock_value`, `current_mac` as columns on master tables.
- These are always **derived at read time** via SQL or service functions.
- If you find yourself writing `UPDATE invoices SET paid_amount = ...` — STOP. That's the failure pattern. Use payment_allocations and let the GL be the truth.

### Rule 2 — Every GL Post Goes Through The Posting Engine

- All GL writes go through ONE function: `postJournalEntry(entries, metadata)` in `src/core/accountingEngine.ts`.
- Never call `supabase.from('general_ledger').insert(...)` directly from any UI module, hook, or service. EVER.
- The posting engine validates: balance, source-type mapping, period lock, account validity, account active status, no-mix-Dr-Cr-on-line, currency conversion.
- Reversals go through `reverseJournalEntry(je_id)`. They never DELETE rows.

### Rule 3 — snake_case Everywhere, No DTOs

- Database columns: snake_case (`oe_number`, `total_amount`)
- TypeScript types: snake_case (matches DB exactly)
- Object keys in components: snake_case
- React props: snake_case for data fields, camelCase only for handlers (`onSave`, `onCancel`)
- File names: kebab-case (`invoice-editor.tsx`)
- Function names: camelCase (`postJournalEntry`)
- React component names: PascalCase (`InvoiceEditor`)
- **No transformer layer between DB and UI.** What the DB returns is what the component reads.

### Rule 4 — All Tables Have `company_id`. RLS Is The Enforcer.

- Every table (except global lookups like `vehicle_makes` shared across tenants) has a `company_id UUID NOT NULL` column.
- Every table has an RLS policy that filters by `company_id = current_user_company_id()`.
- Application code does NOT need to filter by `company_id` — RLS handles it. But application code MUST set `company_id` on every INSERT.
- `company_id` is a UUID, NEVER a name string. If you write `company_id: company.name` you are repeating the previous build's most damaging bug.

### Rule 5 — Phase Discipline Is Absolute

- The current phase is documented in `docs/CURRENT_PHASE.md`.
- Do NOT build features for future phases. If a feature belongs to Phase 7 and you're in Phase 4, decline the request and explain.
- Each phase has a Definition of Done in `docs/Document_5_Build_Phases.md`. The phase is not complete until every checkbox passes.
- Each phase has a verification test. The test must pass before the phase advances.

---

## 2. PROJECT STRUCTURE (LOCKED)

```
stockbolt/
├── docs/                          ← All planning documents (read-only by code)
│   ├── Document_1_Module_Map.md
│   ├── Document_2_Database_Schema.md
│   ├── Document_3_Accounting_Rulebook.md
│   ├── Document_4_Reports_Spec.md
│   ├── Document_5_Build_Phases.md
│   ├── AGENTS.md                  ← This file
│   └── CURRENT_PHASE.md           ← Updated by human as phases advance
│
├── supabase/
│   ├── migrations/                ← Each phase adds migration files, sequentially numbered
│   ├── seeds/                     ← Standard COA, default tax rates, sample data
│   └── policies/                  ← RLS policy SQL
│
├── src/
│   ├── core/                      ← Business logic, framework-agnostic
│   │   ├── accountingEngine.ts    ← postJournalEntry, reverseJournalEntry
│   │   ├── accountingMapping.ts   ← assertJournalMapping per source_type
│   │   ├── accountingConstants.ts ← Account codes, source types
│   │   ├── costingStrategy.ts     ← Interface + MAC implementation
│   │   ├── stockLedger.ts         ← postStockMovement
│   │   ├── periodLock.ts          ← Period-lock guards
│   │   ├── auditLog.ts            ← Audit log writer
│   │   ├── numberSequence.ts      ← Document number generator
│   │   └── invariants.ts          ← The 9 invariants from Doc 4 Part K
│   │
│   ├── data/                      ← Data adapter layer (Supabase / self-hosted abstraction)
│   │   ├── adapter.ts             ← The interface
│   │   ├── supabaseAdapter.ts     ← Cloud implementation
│   │   └── selfHostedAdapter.ts   ← Self-hosted stub
│   │
│   ├── modules/                   ← UI modules (one per Doc 1 module)
│   │   ├── auth/
│   │   ├── onboarding/
│   │   ├── dashboard/
│   │   ├── sales/
│   │   ├── purchases/
│   │   ├── inventory/
│   │   ├── accounts/              ← Banking, COA, GL, JE, PDC, Expenses
│   │   ├── pos/
│   │   ├── reports/
│   │   └── settings/
│   │
│   ├── components/                ← Shared UI components
│   ├── ui/                        ← Design system primitives (Button, Card, Input)
│   ├── hooks/
│   ├── lib/                       ← Helpers (formatters, validators)
│   ├── i18n/                      ← Translation files (en.json, ar.json)
│   ├── store/                     ← Zustand stores (UI state only, no business data)
│   ├── types/                     ← Auto-generated DB types + UI-specific types
│   ├── App.tsx
│   └── main.tsx
│
├── tests/
│   ├── core/                      ← Engine tests (must pass before Phase 4 starts)
│   ├── integration/               ← End-to-end phase verification tests
│   └── invariants.test.ts         ← The 9 invariants
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── .env.example
├── README.md
└── AGENTS.md                      ← Symlink or copy of docs/AGENTS.md
```

**Do not create new top-level folders without updating this section first.**

---

## 3. NAMING CONVENTIONS (HARD RULES)

| Layer | Convention | Example |
|---|---|---|
| Database tables | snake_case, plural | `invoices`, `invoice_items`, `vendor_bills` |
| Database columns | snake_case | `total_amount`, `oe_number`, `created_at` |
| Foreign key columns | `<entity>_id` | `customer_id`, `warehouse_id` |
| TypeScript interfaces | PascalCase, singular | `Invoice`, `InvoiceItem` |
| TypeScript object keys | snake_case (matches DB) | `invoice.total_amount` |
| Functions | camelCase | `postJournalEntry`, `getCustomerBalance` |
| React components | PascalCase | `InvoiceEditor`, `PaymentList` |
| File names | kebab-case | `invoice-editor.tsx`, `payment-list.tsx` |
| Folder names | kebab-case | `sales-quotes`, `bank-accounts` |
| Constants | UPPER_SNAKE_CASE | `MAX_LINE_ITEMS`, `DEFAULT_PAYMENT_TERMS` |
| Enum values (TS) | snake_case strings | `'sales_invoice'`, `'pos_cash_sale'` |
| Translation keys | dot.case | `invoice.editor.add_line` |

**Why this matters:** Your previous build had camelCase TypeScript shapes that didn't match snake_case DB columns. The result was an endless game of `oeNumber → oe_number` translators that drifted out of sync. We avoid this by using snake_case end-to-end. Slightly less idiomatic React, vastly more reliable.

---

## 4. THE ACCOUNTING ENGINE (ABSOLUTE RULES)

### 4.1 — Every Posting Pattern Comes From Doc 3

Doc 3 (Accounting Rulebook) lists every transaction type with its exact debit/credit lines. **Do not invent posting logic.** If a scenario isn't covered:
1. Stop coding
2. Tell the human: "Doc 3 doesn't cover this case. Should we extend Doc 3, or is there an existing pattern that applies?"
3. Wait for confirmation before proceeding

### 4.2 — The Posting Engine Interface

```typescript
// src/core/accountingEngine.ts
export interface JournalLine {
  account_code: string;        // Use code, not id; engine resolves to id
  debit: number;               // 0 if credit line
  credit: number;              // 0 if debit line
  description?: string;
  contact_id?: string;
  related_doc_type?: string;
  related_doc_id?: string;
}

export interface PostJournalEntryParams {
  source_type: SourceType;     // From Doc 3 — strictly enumerated
  source_id?: string;
  date: string;                // YYYY-MM-DD
  description: string;
  currency: string;
  exchange_rate?: number;      // Default 1.0
  lines: JournalLine[];
}

export async function postJournalEntry(
  params: PostJournalEntryParams
): Promise<{ journal_entry_id: string }>;

export async function reverseJournalEntry(
  je_id: string,
  reason: string
): Promise<{ reversal_je_id: string }>;
```

### 4.3 — The Source Type Enum (LOCKED — DO NOT EXTEND WITHOUT DOC 3 UPDATE)

```typescript
export type SourceType =
  | 'sales_invoice'
  | 'pos_cash_sale'
  | 'pos_card_sale'
  | 'inventory_cogs'
  | 'customer_receipt'
  | 'customer_advance'
  | 'advance_application'
  | 'advance_refund'
  | 'sales_credit_note'
  | 'sales_return'
  | 'vendor_bill'
  | 'goods_receipt'
  | 'vendor_payment'
  | 'vendor_advance'
  | 'vendor_debit_note'
  | 'stock_transfer'      // Stock ledger only, no GL — but tagged for completeness
  | 'inventory_adjustment'
  | 'opening_balance'
  | 'bank_transfer'
  | 'direct_receipt'
  | 'expense'
  | 'pdc_creation'
  | 'pdc_bank_post'
  | 'pdc_clear'
  | 'pdc_bounce'
  | 'manual'
  | 'year_end_close';
```

### 4.4 — assertJournalMapping (Validator)

For each `source_type`, the validator enforces which accounts are allowed in the lines. Refer to Doc 3 Part I — Validator Reference.

If a posting violates the mapping, **the engine throws an error and the entire transaction rolls back.** No partial posts.

### 4.5 — The Costing Strategy

ALL cost-related calculations go through `CostingStrategy`. Refer to Doc 3 Part O.

```typescript
// src/core/costingStrategy.ts
export interface CostingStrategy {
  getCostAtSale(productId, warehouseId, quantity, saleDate): Promise<number>;
  recordPurchase(productId, warehouseId, quantity, unitCost, purchaseDate): Promise<void>;
  recordSale(productId, warehouseId, quantity, costAtSale, saleDate): Promise<void>;
  recordReturn(productId, warehouseId, quantity, originalCost, lotId?): Promise<void>;
  getCurrentValuation(productId, warehouseId): Promise<number>;
}
```

**v1 ships ONE implementation: `MovingAverageCostingStrategy`.**

**Forbidden in v1:**
- Do not write `FIFOCostingStrategy`
- Do not write `LIFOCostingStrategy` (banned in any version — see Doc 3 Part O.2)
- Do not write `StandardCostingStrategy`
- Do not inline MAC formulas in invoice/GRN/return code

If a prompt asks for FIFO or LIFO, decline and reference Doc 3 Part O.

---

## 5. THE 9 INVARIANTS (CONSTANTLY VERIFIED)

These are listed in Doc 4 Part K. Implement as a runnable function:

```typescript
// src/core/invariants.ts
export async function verifyInvariants(
  company_id: string,
  as_of_date: string
): Promise<InvariantResult[]>;
```

Each invariant returns `{ name, expected, actual, passed, difference }`.

The 9 invariants:
1. Trial Balance balances (Dr total = Cr total)
2. Balance Sheet balances (Assets = Liabilities + Equity)
3. AR Aging total = AR account (1200) balance
4. AP Aging total = AP account (2100) balance
5. Stock Valuation total = Inventory (1300) balance
6. Customer Advances (2400) — all customer balances are credits
7. Vendor Advances (1400) — all supplier balances are debits
8. GRN Accrual (2150) total = Unbilled GRN sum
9. Daily Cash report closing = Cash in Hand (1100) + bank accounts

**Tolerance: 0.01 currency units.**

This function is exposed as a Settings → System Health button. It must run quickly enough to be on-demand (target: <2 seconds for a database with 100,000 GL rows).

**During development: run this function automatically in tests after every business operation.** If any invariant fails, that operation has a bug.

---

## 6. WHEN TO STOP AND ASK

These are scenarios where you MUST NOT silently make a decision. Stop and ask the human:

1. **Doc 3 doesn't cover the transaction type.** Ask before inventing one.
2. **Doc 2 doesn't have a column you need.** Don't add it silently — ask whether to update Doc 2.
3. **A user request mentions LIFO or any v2-only feature.** Decline and reference the appropriate doc.
   *(AMENDED 2026-06-13: Payroll was moved INTO v1 by explicit owner decision after the decline rule was surfaced and confirmed. It is built in phases: P1 employees + monthly runs + GL posting [done], P2 WPS SIF export + gratuity accrual, P3 employee loans UI, P4 leave tracking. LIFO remains permanently excluded.)*
4. **A user request would break an invariant.** Stop. Explain.
5. **You can't decide between two interpretations of a Doc 3 rule.** Don't pick — ask.
6. **A test in your phase's verification scenario is failing and you can't immediately see why.** Don't patch around it — escalate.
7. **The current phase's Definition of Done conflicts with what you're being asked to build.** Stop and clarify scope.
8. **You'd need to write `UPDATE invoices SET paid_amount = ...` to make something work.** STOP — that's the bug. Find the right way.

When stopping, your response template:

> "Before I proceed, I need to flag: [issue]. This relates to [Doc X Part Y]. The options I see are: [option A] or [option B]. Which should I take?"

---

## 7. RULES BY DOMAIN

### 7.1 — UI Rules

- Use Tailwind for styling. Use the design tokens defined in `tailwind.config.js`.
- **Color palette is locked** (light theme, indigo primary — derived from approved Phase 0 screenshots). Do not introduce new accent colors without approval. Tailwind token names in parentheses.
  - Primary indigo: `#5B5BD6` (`brand-500`) — buttons, active nav, logo, FAB
  - Brand scale: `brand-50`…`brand-900` available for hover/pressed/disabled states
  - Page background: `#FFFFFF` (`surface-page`)
  - Card background: `#FFFFFF` (`surface-card`) with `border-border-subtle` (`#E5E7EB`) and `shadow-card`
  - Muted surface: `#F3F4F6` (`surface-muted`) — nav pills, search input background
  - Subtle surface: `#F9FAFB` (`surface-subtle`) — table stripes, hover rows
  - Text primary: `#111827` (`ink-primary`)
  - Text secondary: `#6B7280` (`ink-secondary`)
  - Text tertiary: `#9CA3AF` (`ink-tertiary`)
  - Success: `#22C55E` (`success-500`); Danger: `#EF4444` (`danger-500`); Warning: `#F59E0B` (`warning-500`)
  - KPI accent backgrounds (pastel): `kpi-mint`, `kpi-lavender`, `kpi-peach`, `kpi-rose`, `kpi-slate`, `kpi-sky`
- **Shape language is locked.** Buttons and inputs use `rounded-pill` (full pill, `9999px`). Cards use `rounded-card` (`16px`).
- Typography: **DM Sans** for Latin (`font-sans`), **Tajawal** for Arabic (`font-arabic`). Loaded via Google Fonts in `index.html`. The `font-arabic` family applies automatically when `<html dir="rtl">` is set (handled in `src/index.css`).
- Every UI string goes through i18n. Never hardcode user-facing English. (Internal labels in JSDoc are fine.)
- Every form has explicit save/cancel buttons. Auto-save is forbidden in v1 (it caused issues last build).
- Forms with unsaved changes show a confirmation modal on navigation away (use `useUnsavedChangesGuard`).
- Tables paginate at 50 rows by default, 100 max. Reports specifically may go higher with explicit virtualization.

### 7.2 — Forms & Validation

- Use react-hook-form for all forms.
- Validation messages must be translatable.
- Required fields show a red asterisk and explain the rule on blur.
- Money inputs: 2 decimal places, no thousands separator while editing, formatted on blur.
- Quantity inputs: 3 decimal places.
- Dates: ISO format (YYYY-MM-DD) in storage; locale-aware in display.
- Currencies: locked at document creation. Don't allow currency change after first save.

### 7.3 — Data Adapter Layer

- All Supabase calls go through `src/data/adapter.ts`. UI components do NOT import `supabase` directly.
- The adapter exposes typed methods like `getInvoiceById(id)`, `listInvoices(filters)`, `createInvoice(data)`.
- This abstraction is what makes self-hosted mode possible later. Don't bypass it.
- Realtime subscriptions also go through the adapter.

### 7.4 — State Management

- Server data: lives in TanStack Query (React Query). It's the cache for adapter calls.
- UI state (modals open, current tab, filter selections): Zustand stores in `src/store/`.
- **Never put server data in Zustand.** That was a previous bug pattern — Zustand stores drifted from DB.
- Mutations invalidate the relevant queries on success.

### 7.5 — Routing

- React Router v6. Routes defined in `src/App.tsx`.
- Authenticated routes wrapped in `<RequireAuth>`.
- Onboarding-required routes wrapped in `<RequireOnboarded>`.
- Role-restricted routes wrapped in `<RequireRole role="admin">`.

### 7.6 — Internationalization (EN + AR)

- Use `i18next` with two namespaces: common, modules.
- Every translation has both `en` and `ar` values. No fallback to English in Arabic mode.
- Detect direction from `i18n.dir()` and apply `dir={dir}` at the app root.
- Tailwind classes that depend on direction (e.g., `mr-4` vs `ml-4`) use the logical equivalents (`me-4`, `ms-4`) which Tailwind already supports.
- Bilingual data fields: always store both `name` and `name_ar`. Display the right one based on UI language. Print templates may show both side-by-side.
- Numbers: Western Arabic numerals (0–9) by default. Eastern Arabic numerals (٠–٩) optional in settings (out of v1 scope).
- Date formatting: dayjs with locale-aware formatting.

### 7.7 — Multi-Currency

- Every monetary document has a `currency` field and an `exchange_rate` field.
- The GL is always posted in base currency (the company's `base_currency`).
- Exchange rate is captured at document creation time and frozen.
- For receipts/payments against a foreign-currency document, FX gain/loss is calculated by the engine and posted automatically (Doc 3 J2).
- Never manually adjust GL for FX — let the engine do it.

### 7.8 — File Uploads

- Use Supabase Storage with three buckets: `logos`, `products`, `attachments`.
- Apply RLS to storage too: a user can only access files in their company's path.
- Path convention: `{bucket}/{company_id}/{entity_type}/{entity_id}/{filename}`.
- Image uploads: validate MIME type, max 5 MB per image.
- Show upload progress. Show a placeholder if image fails to load.

---

## 8. DATABASE PATTERNS

### 8.1 — Migrations

- Every schema change is a numbered migration file in `supabase/migrations/`.
- Migrations are append-only. Never edit a previous migration.
- Each migration is wrapped in a transaction.
- Each migration includes its own rollback (so we can revert in dev).

### 8.2 — Triggers

- Every table has an `updated_at` trigger that auto-updates on UPDATE.
- The GL has a CHECK constraint enforcing `total_debit = total_credit` per JE.
- The GL has a CHECK constraint enforcing each row has either debit or credit, not both.

### 8.3 — Indexes

- Every foreign key column has an index.
- Every column used in `WHERE` clauses (date ranges, status filters, contact_id, warehouse_id) has an index.
- Composite indexes for the most common multi-column filters (e.g., `(account_id, date)` for GL).

### 8.4 — Views

- `gl_active` and `stock_active` are views that exclude reversed rows. ALL reports read from these views, never from raw `general_ledger` or `stock_ledger`.

### 8.5 — RLS Policies

Every table has this policy template:

```sql
CREATE POLICY tenant_isolation ON <table_name>
  FOR ALL
  USING (company_id = (SELECT company_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM profiles WHERE id = auth.uid()));
```

Some tables have additional policies (e.g., audit_logs is INSERT-only via SECURITY DEFINER function, not direct). Document any deviation in the migration file.

---

## 9. CODE QUALITY RULES

### 9.1 — TypeScript Strictness

```json
// tsconfig.json — non-negotiable settings
"strict": true,
"noImplicitAny": true,
"strictNullChecks": true,
"noUnusedLocals": true,
"noUnusedParameters": true,
"noImplicitReturns": true
```

`any` is forbidden except as explicitly justified inline (e.g., third-party libs without types). Use `unknown` instead.

### 9.2 — Function Length

- Functions over 60 lines should be broken up.
- React components over 200 lines should be split into sub-components.
- Files over 500 lines: review for module boundary violations.

### 9.3 — Error Handling

- Every async function in `src/core/` has explicit error handling.
- User-facing errors are translated and surfaced via toast or inline form errors.
- Engine-level errors (mapping violation, unbalanced JE) are typed exceptions, not generic Errors.
- Never swallow errors silently. If you catch an error, you log it OR surface it OR rethrow.

### 9.4 — Comments

- Comment WHY, not WHAT. Code shows what; comments explain why.
- Functions in `src/core/` have JSDoc with parameter descriptions and an example.
- Reference Doc 3 sections in accounting code: `// Per Doc 3 A1: Sales Invoice posting`.

### 9.5 — Tests

- Every function in `src/core/` has unit tests.
- Each phase has integration tests matching the verification scenarios in Doc 5.
- The 9 invariants are tested after every state-mutating test.
- Tests run in CI; PRs cannot merge with failing tests.

---

## 10. PROHIBITED PATTERNS

These are explicitly banned. Don't write them, ever:

| Pattern | Why It's Banned | What To Do Instead |
|---|---|---|
| `UPDATE invoices SET paid_amount = ...` | Cached aggregate (Rule 1 violation) | Derive from payment_allocations |
| `products.stock_quantity` as a column | Cached aggregate (Rule 1 violation) | Derive from stock_ledger |
| `contacts.outstanding_balance` as a column | Cached aggregate (Rule 1 violation) | Derive from gl_active |
| `localStorage.setItem('invoices', ...)` | Was the previous build's fantasy DB | Use Supabase always |
| `company_id: company.name` | UUID/name confusion (the previous build's deepest bug) | `company_id: company.id` (UUID) |
| `INSERT INTO general_ledger ...` from UI code | Bypasses validator (Rule 2) | Use postJournalEntry |
| `DELETE FROM general_ledger ...` | Reversal-not-delete (Doc 3 Rule 5) | Use reverseJournalEntry |
| Camel-cased DB column access (`item.oeNumber`) | Naming inconsistency (Rule 3) | Use snake_case (`item.oe_number`) |
| Hardcoded English strings in UI | Breaks Arabic support | Use t('translation.key') |
| Currency conversion in UI components | Engine's job, not UI's | Engine handles via exchange_rate |
| `cogs_strategy === 'skip'` branches | Removed; defer is the only behavior | The engine handles this transparently |
| New CostingStrategy implementations in v1 | v1 is MAC-only | Decline; reference Doc 3 Part O |
| Building features for future phases | Phase discipline (Rule 5) | Decline; explain phase boundary |

---

## 11. WORKING WITH THE HUMAN

### 11.1 — Session Start Checklist

At the start of every session, before writing code:
1. Read `docs/CURRENT_PHASE.md` to know what phase you're in
2. Read the current phase's section in `docs/Document_5_Build_Phases.md` for scope and DoD
3. Confirm scope with the human if anything is ambiguous
4. Cross-reference any feature against Docs 1, 2, 3, 4 before implementing

### 11.2 — Ending A Work Session

Before declaring work "done":
1. Run the project linter: `npm run lint`
2. Run TypeScript check: `npm run typecheck`
3. Run relevant tests
4. If you touched accounting code: run the invariants test
5. Update the current phase checklist if a DoD item passed
6. Commit with a descriptive message

### 11.3 — Commit Messages

Format: `[PhaseN] type(scope): description`

Examples:
- `[Phase3] feat(core): add postJournalEntry with mapping validator`
- `[Phase4] fix(sales): invoice edit reverses old GL rows correctly`
- `[Phase4] test(sales): add Phase 4 verification scenario`

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

### 11.4 — When Documentation Drifts

If during implementation you discover that Doc 2 or Doc 3 is wrong or incomplete:
1. STOP coding
2. Tell the human: "Doc X says Y but the correct behavior should be Z because [reason]. Should we update Doc X?"
3. Wait for confirmation
4. Update the doc IN THE SAME COMMIT as the code change
5. Reference the doc update in the commit message

**Documentation and code are version-controlled together. They never drift.**

---

## 12. WHAT TO DO ON SECURITY-RELEVANT WORK

- All RLS policies must be tested with a multi-tenant test (User A in Company X cannot see Company Y's data).
- All Supabase Edge Functions (if used) check `auth.uid()` and look up the user's `company_id` from `profiles` — never trust client-supplied `company_id`.
- Storage paths include `{company_id}` and storage RLS rejects access to other companies' paths.
- Authentication errors return generic messages. Don't leak whether an email exists.
- Password reset tokens expire after 1 hour.

---

## 13. PERFORMANCE GUIDELINES

- Reports with potential >10,000 rows use database-side aggregation, not client-side.
- Tables paginate. Default page size: 50.
- Searches debounce at 300ms.
- The Trial Balance, Balance Sheet, and Stock Valuation queries each have target sub-500ms response time on a database with 100,000 GL rows.
- If a query exceeds budget: add an index, materialize a view, or rethink the query. Don't paper over with a loading spinner.

---

## 14. ENVIRONMENT VARIABLES

```bash
# .env.example

# Deployment mode
VITE_DEPLOYMENT_MODE=cloud   # cloud | self_hosted

# Supabase (cloud mode)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Self-hosted mode (only set when DEPLOYMENT_MODE=self_hosted)
VITE_API_URL=

# Localization
VITE_DEFAULT_LANGUAGE=en      # en | ar
VITE_DEFAULT_COUNTRY=AE       # AE | SA | KW | BH | OM | QA | IN

# Feature flags (rare; default to off)
VITE_ENABLE_DEBUG_PANEL=false
```

Never commit `.env` files. Always commit `.env.example`.

---

## 15. ARABIC AND RTL CONSIDERATIONS

Bilingual support is not optional and not a polish task. It's checked in every phase's DoD.

- The `dir` attribute on `<html>` is set to `rtl` when language is Arabic, `ltr` otherwise.
- All Tailwind layout uses logical properties: `ms-*` and `me-*` instead of `ml-*` and `mr-*`. Borders, padding, etc. follow the same rule.
- Icons that imply direction (arrows, chevrons) are flipped via CSS `transform: scaleX(-1)` in RTL mode.
- Tables in RTL: column order reverses. Tailwind's `dir`-aware classes handle this if used correctly.
- Number columns stay left-aligned even in RTL (Western numerals are LTR characters within RTL text). Apply `dir="ltr"` and `text-end` (which becomes left in RTL).
- Print templates have separate Arabic versions or bilingual side-by-side layouts.
- Test in Arabic mode after every feature. The phase's DoD requires it.

---

## 16. DEPLOYMENT MODES

The codebase supports two deployment modes (see Doc 1):

### Cloud (SaaS) Mode

- `VITE_DEPLOYMENT_MODE=cloud`
- Backend: Supabase (Postgres + Auth + Storage + RLS)
- Frontend: Vercel
- Multi-tenant: many companies on shared infrastructure

### Self-Hosted Mode

- `VITE_DEPLOYMENT_MODE=self_hosted`
- Backend: vanilla PostgreSQL + small Express layer (provides auth + REST endpoints in lieu of Supabase)
- Frontend: bundled into Docker image with backend
- Single-tenant: one company per install
- RLS not used (only one company exists, irrelevant)

The data adapter layer abstracts these. UI code never knows which mode it's running in.

In v1, cloud mode is the priority. Self-hosted is a stub that will be filled out in Phase 12 or v1.1.

---

## 17. CONTEXT MANAGEMENT (FOR LONG SESSIONS)

When working with humans across multiple sessions on this codebase:

- Do not assume previous-session context. Re-read AGENTS.md and CURRENT_PHASE.md.
- If the human references "what we discussed last time," ask them to summarize unless it's clearly written in the docs or commit history.
- Major architectural decisions go in the docs, not in commit messages. If a decision was made conversationally, propose a doc update before relying on it.

---

## 18. THE LITMUS TEST

Before merging any PR or considering any task done, run this mental check:

1. ✓ Does it follow the 5 Inviolable Rules?
2. ✓ Does it match the conventions in Sections 3 and 4?
3. ✓ Are the 9 invariants still true after this change?
4. ✓ Do tests pass?
5. ✓ Are docs updated if behavior changed?
6. ✓ Does the current phase's DoD have one more checkbox tickable now?
7. ✓ Could this change be understood by a developer reading only the docs and code, not the chat history? If not, document the why.

If all 7 are yes, the work is genuinely done.

---

## 19. THE FAILURE MODES TO PREVENT

For posterity, these are the specific failure modes from the previous build that this document is designed to prevent. If you find yourself reproducing any of them, stop:

1. **The schema-code drift trap.** 14 tables in schema, 30+ used in code. → Fixed by Doc 2 being the canonical schema source, and migrations being the only way to evolve it.

2. **The UUID-vs-name foreign key trap.** `company_id: company.name` worked in localStorage, broke catastrophically in Postgres. → Fixed by Rule 4 above.

3. **The cached aggregate drift trap.** `invoices.paid_amount` and `products.stock_quantity` drifted from the GL. → Fixed by Rule 1.

4. **The mapping inconsistency trap.** Each module's posting code had slightly different debit/credit logic. → Fixed by Doc 3 being the single source for posting rules + Rule 2 enforcing it.

5. **The parallel-build trap.** All modules built at 80%, none at 100%. → Fixed by Phase Discipline (Rule 5 + Doc 5).

6. **The naming schism trap.** camelCase TS over snake_case DB created an endless translation layer that drifted. → Fixed by Rule 3.

7. **The "I'll add features later" trap.** Speculative features built before customer feedback became technical debt. → Fixed by Phase 12 being the launch gate, with all v2 features explicitly excluded from v1.

---

## 20. CLOSING NOTE

This document and the five planning documents (1–5) represent the complete contract for what StockBolt v1 is. They are the agreement between the human, the AI agents, and future maintainers.

If you're an AI agent reading this for the first time: welcome. Take the rules seriously. They're not arbitrary — each one is paid for in the time and frustration of a previous build that didn't follow them.

If you're a human reading this and you've never built software with an AI agent before: this document is your superpower. As long as the AI follows AGENTS.md, you'll get consistent, correct work. The moment the AI starts ignoring it, you have something concrete to point at.

**Build slow. Build right. Ship a v1 that works.**

— End of AGENTS.md —
