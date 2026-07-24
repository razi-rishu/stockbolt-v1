# StockBolt — AC-1.2: Year-End Close — UI / Workflow Specification (design only)

**Created:** 2026-07-24 · Design + UI spec only, no code. Uses the existing StockBolt design language. Backed by the AC-1.1 engine (`close_fiscal_year` / `reopen_fiscal_year` / `fiscal_year_closes`, hard close, sequential + LIFO, `accounting.write`).

**Design-language anchors [VERIFIED live]:** page header `<h1 class="text-xl font-semibold text-ink-primary">`; toolbars in a `data-print-hide` flex row; `<Modal open onClose title width>` (portal, backdrop-blur, ESC, `rounded-card bg-surface-card shadow-elevated`) for confirmations; `<Button>` from `@/ui/button`; TanStack Query (`useQuery`/`useMutation` + `getAdapter().accounting.*`); Tailwind semantic tokens (`text-ink-primary/secondary/tertiary`, `bg-surface-page/card`, `bg-brand-600`, `border-border-subtle`); report tables `text-sm` with net-profit coloring green `#15803d`/`bg #f0fdf4`, loss red `#dc2626`/`bg #fef2f2`; `<DocLink>` for JE drill-down; i18n `t(...)` EN/AR.

**North star:** simple, accountant-friendly, one guided year at a time, **always confirm before posting**, always reversible.

---

## 1. Navigation
- New leaf route **`/accounting/year-end-close`**, lazy-loaded (`YearEndClosePage`), inside the existing route guard `RequirePermission perm="accounting.read"`.
- Add to the **Accounting** nav group in `app-layout.tsx` (after Period Lock): `{ to: '/accounting/year-end-close', label: t('nav.year_end_close') }`. Icon inherits the group; label EN "Year-End Close" / AR "الإقفال السنوي".
- A shared `<BackButton>` (frosted-glass pill) to `/accounting` per the leaf-page convention.

## 2. Permissions
- **Route:** `accounting.read` (view the page + history) — matches the other Accounting screens.
- **Actions (Close / Reopen):** gated by `accounting.write` (matches the RPCs' `auth_require('accounting.write')`). Read-only users see the page and history but the **Close/Reopen buttons are hidden** (use the existing permission gate, `usePermission('accounting.write')` / `RequirePermission` button-level pattern). The RPC is the ultimate guard.

## 3. Read-only preview screen (the page's primary panel)
Single page, two stacked regions:
- **A — "Close a fiscal year"** (top): the **next fiscal year ready to close** (earliest ended, un-closed year whose prior year is closed or had no activity), presented with its preview. Header line: *"Fiscal Year 2024 · 1 Jan 2024 – 31 Dec 2024 · ready to close."* No free year-picker in v1 — the sequential guard makes a picker error-prone; the page leads the user to the correct next year and advances after each close.
- **B — "Closed fiscal years"** (below): the history list (§10).
The preview is **entirely read-only** — it computes the closing entry client-side (adapter `previewYearEndClose`, §15) and never writes. Confirming is the only write.

## 4. Net Income display + Closing Impact Summary
The headline of the preview is a **Closing Impact Summary** card (bordered, `bg-surface-card`) that consolidates, in plain terms, exactly what the close will do — the accountant's "am I sure?" panel. It sits above the detailed closing-journal table (§5).

**4a. Net income tiles** (top of the card, P&L color language): **Total Income** · **Total Expenses** · **Net Profit / (Loss)** (large, green `#15803d` profit / red `#dc2626` loss), with a **"View full Profit & Loss →"** deep-link to `/reports/profit-loss` for the same range (parity: the preview reuses `getProfitAndLoss`, which AC-1.0 already filters).

**4b. Closing Impact Summary** — a labeled key/value list (2-col on desktop, stacked on mobile) with these fields:
| Field | Example |
|---|---|
| Fiscal Year | **2024** (1 Jan 2024 – 31 Dec 2024) |
| Income accounts to be zeroed | **6** |
| Expense accounts to be zeroed | **11** |
| Journal lines in the closing entry | **18** (6 income + 11 expense + 1 Retained Earnings) |
| Net Profit / (Loss) | **AED 190,000.00** (green) / **(AED 12,000.00)** loss (red) |
| Retained Earnings account | **3100 — Retained Earnings** |
| Period lock date after close | **31 Dec 2024** (currently: *none* / *31 Dec 2023*) |

**4c. Plain-language explanation** (a callout below the fields): *"Closing fiscal year 2024 will post one journal entry dated 31 Dec 2024 that moves the net profit of **AED 190,000.00** into Retained Earnings (3100), resets every income and expense account to zero for the year, and locks the period through **31 Dec 2024** so it can't be changed. You can reopen this year later if you need to make adjustments."* (Loss variant swaps "moves the net loss … out of Retained Earnings"; zero-activity variant: "records the year as closed with no journal entry.")

The counts (income/expense accounts, journal line count) come straight from the preview lines, so the summary and the §5 table always agree.

## 5. Closing journal preview
The exact entry that will post, as a read-only table (`text-sm`, same styling as the report tables):

| Account | Debit | Credit |
|---|--:|--:|
| 4000 Sales … (each income leaf, Dr) | 250,000.00 | |
| 6100 Rent … (each expense leaf, Cr) | | 60,000.00 |
| … | | |
| **3100 Retained Earnings** (net → RE) | | **190,000.00** |
| **Total** | **250,000.00** | **250,000.00** |

- The **3100 Retained Earnings** row is emphasized (bold, subtle brand tint). Profit → RE on the credit side; loss → RE on the debit side.
- A **balanced badge** ("Debits = Credits ✓") reassures before posting; totals row shows both columns equal.
- Caption: *"Posting this entry zeroes income & expense into Retained Earnings and locks the period through 31 Dec 2024."*
- The table is horizontally scrollable in its own `overflow-x-auto` container (mobile).

## 6. Validation messages (surfaced inline before/around the Close button)
Preview + button reflect the engine's guards, shown as calm inline notices (not errors) so the user understands *why* they can/can't close:
- **Ready:** green check line — "Fiscal year 2024 is ready to close."
- **Year not ended:** "Fiscal year 2025 ends 31 Dec 2025 — you can close it after it ends." (Close disabled.)
- **Prior year not closed:** "Close fiscal year 2023 first — years are closed in order." (Close disabled; a link/CTA to the prior year.)
- **Retained Earnings missing:** "Account 3100 Retained Earnings is not set up — add it in the Chart of Accounts." (Close disabled; link to CoA.)
- **No activity:** "Fiscal year 2024 has no income or expense — closing it records the year with no journal entry." (Close enabled; the confirm dialog restates this.)
These mirror the RPC's `RAISE` conditions so the UI never lets the user hit a server error it could have prevented.

## 7. Confirmation dialog (`<Modal width="md">`)
Triggered by **"Close fiscal year 2024"**. Title: *"Close Fiscal Year 2024?"*. Body:
- Restated **Net Income** (green/red) and the **period locked** date.
- Bullet reassurances: *"Posts one closing journal entry (JE-####). · Locks the period through 31 Dec 2024. · You can reopen this year later — it's reversible."*
- Footer: **Cancel** (ghost) · **Close fiscal year** (primary `bg-brand-600`; the destructive-but-reversible action, so primary not red). Focus starts on Cancel.
- Requires this explicit confirm — no one-click close from the page.

## 8. Closing progress
- On confirm, the primary button enters a pending state: spinner + **"Closing…"**, disabled; the modal stays open and non-dismissable (backdrop click / ESC disabled while `isPending`).
- Optimistic UI is **not** used (financial posting) — wait for the RPC result.

## 9. Success screen
On success, the modal swaps to a success state (or a toast + inline success card):
- ✓ **"Fiscal Year 2024 closed."** Entry **JE-#### (`<DocLink>` to `/accounting/journal-entries/:id`)**, Net Income restated, period locked through 31 Dec 2024.
- Actions: **View journal entry** (DocLink) · **Done** (closes the modal).
- The page then re-queries: the closed-years list gains the row, and the top panel advances to the **next** closeable year (or the empty state if none remain).

## 10. Closed fiscal years list (region B)
A table (`text-sm`), newest first:

| Fiscal Year | Period | Net Income | Status | Closed | Closing Entry | Actions |
|---|---|--:|---|---|---|---|
| 2024 | 1 Jan–31 Dec 2024 | 190,000.00 | **Closed** (badge) | 24 Jul 2026 · by A. Rashid | JE-#### (DocLink) | **Reopen** |
| 2023 | … | (12,000.00) loss (red) | **Reopened** (amber badge) | … | JE-#### | — |

- **Status badges:** `Closed` (green/brand tint), `Reopened` (amber). `draft` reserved — not shown in v1.
- **Reopen** appears **only on the most-recent closed year** (LIFO); older closed rows show a muted "—" with tooltip *"Reopen 2024 first."*
- Row → drill into the closing JE via `<DocLink>`.

## 11. Reopen workflow
- **Reopen** (on the latest closed year) opens a `<Modal>`: *"Reopen Fiscal Year 2024?"* — body: *"This reverses the closing entry and unlocks the period so you can post adjustments. Only the most recent closed year can be reopened; you can re-close it afterward."* Footer: **Cancel** · **Reopen** (amber/warning). Progress + success mirror §8–§9 (*"Fiscal Year 2024 reopened."*), status → `Reopened`, the top panel re-offers it as closeable.

## 12. Error handling
- All RPC errors surface as a **toast** + an inline alert in the dialog; the modal stays open so the user can retry/cancel.
- Map ERRCODEs to friendly copy: `42501` → "You don't have permission to close/reopen fiscal years." · `P0001` "already closed" / "not closed" / "close prior year first" / "reopen later years first" / "RE 3100 not found" → the exact guidance strings. Never show raw Postgres text.
- Network failure → "Couldn't reach the server — nothing was posted. Try again."

## 13. Audit history
- The closed-years list *is* the primary audit surface: `closed_at/by`, `reopened_at/by` per row.
- Each closing/reopening JE drills through `<DocLink>` to the full entry.
- A footer link **"View in Audit Log →"** deep-links `/reports/audit-log` (the close/reopen RPCs write `close_fiscal_year` / `reopen_fiscal_year` audit rows), so the full who/when trail is available.

## 14. Mobile / responsive behavior
- Page uses the standard responsive container; the 3-tile net-income card stacks to 1 column on mobile.
- The closing-journal preview table and the closed-years table each live in `overflow-x-auto` wrappers (never break the page's horizontal scroll).
- `<Modal>` is `width="md"` on desktop, effectively full-width via its `p-4` inset on mobile; buttons stack full-width under ~380px.
- Dark mode + RTL inherited from the app shell (Arabic labels provided).

## 15. API interactions (adapter methods to add in AC-1.2)
Under `getAdapter().accounting.*`, backed by AC-1.1:
- **`previewYearEndClose(company_id, fiscal_year)`** → computes `fy_start/fy_end` from `company.fiscal_year_start`, calls the existing `getProfitAndLoss(company_id, fy_start, fy_end)` (already excludes `year_end_close`), returns `{ fiscal_year, fy_start, fy_end, total_income, total_expenses, net_income, lines[] }`. **Read-only, no RPC** (matches the "preview is read-only/client-side" decision; parity with the RPC because both use the same income/expense aggregation incl. archived accounts).
- **`getNextCloseableFiscalYear(company_id)`** → earliest ended, un-closed FY with activity whose prior year is closed/empty (drives region A). Client-derivable from the closed-years list + company start.
- **`listFiscalYearCloses(company_id)`** → `SELECT * FROM fiscal_year_closes` (RLS-scoped) for region B.
- **`closeFiscalYear(company_id, fiscal_year)`** → `rpc('close_fiscal_year', { p_fiscal_year })`.
- **`reopenFiscalYear(company_id, fiscal_year)`** → `rpc('reopen_fiscal_year', { p_fiscal_year })`.
- **Query invalidation** after close/reopen: the `fiscal_year_closes` list, the `company` query (its `period_lock_date` changed), and the reports (`profit-loss`, `balance-sheet`, `trial-balance`) so downstream figures refresh.

## 16. Loading states
- Region A preview: a lightweight skeleton (the 3 tiles + a few table rows shimmer) while the preview query runs; `t('common.loading')` fallback text elsewhere, consistent with the reports.
- Region B list: spinner/skeleton rows while `listFiscalYearCloses` loads.
- Close/Reopen mutations: the button spinner (§8); the rest of the page stays interactive but the mutating year's actions disable.

## 17. Empty states
- **No fiscal year has ended yet** (new company): a friendly empty card — *"Your first fiscal year (ending 31 Dec 2025) isn't over yet. Come back after year-end to close the books."* No Close button.
- **All caught up:** *"All ended fiscal years are closed. 🎉"* with the history list below.
- **No closed years yet** (region B): *"No fiscal years have been closed yet."*
- **Retained Earnings not set up:** the CoA-link notice from §6 replaces the preview.

## 18. Regression scenarios (UI-level; behavioural DB tests are AC-1.3)
- Preview **Net Income == the P&L** for the same window (visual parity; both exclude `year_end_close`).
- Closing-journal preview **balances** (Debits = Credits) for profit, loss, and mixed/contra cases.
- **Confirm is required** before any post (no one-click close).
- **Reopen shows only on the latest** closed year (LIFO); older rows disabled with the tooltip.
- **Read-only user** (no `accounting.write`) sees the page + history but **no Close/Reopen** controls.
- Validation notices match the engine guards (year not ended / prior not closed / RE missing / no activity) so the UI pre-empts server errors.
- After close, the list updates and the panel advances to the next year; after reopen, the year returns as closeable.
- Mobile: both tables scroll inside their wrappers; the page body never scrolls horizontally.

---

### Locked UI decisions (confirmed 2026-07-24)
1. **Year selection — guided "next closeable year" only.** No year-picker dropdown in v1. The page leads to the correct next fiscal year in sequence and advances after each close; older years are reviewed via their closing-JE drill-down in the closed-years list (§10).
2. **Success — the confirmation modal swaps to a success modal** after the close/reopen posts (keeps the entry number + `<DocLink>` to the JE in front of the user). No toast/inline-card variant.
3. **Entry point — Accounting nav item + page only.** No Dashboard prompt in AC-1.2 (can be a later enhancement).
4. **Closing Impact Summary is required on the preview** (§4b) — Fiscal Year, income-account count, expense-account count, journal-line count, Net Profit/(Loss), Retained Earnings account, period lock date after close, plus the plain-language explanation of what the close will do.

_Awaiting your approval before implementing AC-1.2._
