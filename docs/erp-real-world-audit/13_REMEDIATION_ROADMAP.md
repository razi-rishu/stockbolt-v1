# 13 Remediation roadmap

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

Order: security and money first, screens last. Each phase needs separate approval; each migration is applied by hand after staging proof. Nothing here has been started.

| Phase | Name | Issues | Complexity | Depends on |
|---|---|---|---|---|
| 1 | Security and posted-document protection | SEC-01, SEC-02, SEC-03, SEC-04 | High | - |
| 2 | Financial integrity | PAY-01, PAY-02, PUR-01, PUR-02, SAL-01, SAL-02, SAL-04, ACC-01, ACC-02, ACC-03, ACC-04, ACC-05, HR-01, RPT-01, RPT-02 | High | Phase 1 |
| 3 | Operations: purchasing, stock, POS, cancellation | PUR-03, PUR-04, PUR-05, SAL-03, POS-01, POS-02, INV-01, INV-04, PUR-06 | Medium | Phase 1 |
| 4 | Reports and banking control | ACC-06, BNK-01, BNK-02, RPT-03, RPT-04, RPT-05, RPT-06 | Medium | Phase 2 |
| 5 | Hardening and tidy-up | SEC-05, SEC-06, SAL-05, INV-02, GEN-01, DOC-01, DOC-02 | Medium | Phase 2 |
| 6 | Missing modules (each separately approved) | INV-03, BNK-03, HR-02, HR-03, RPT-07, SO-01, PR-01 | High | Phases 1-3 |

## Phase 1: Security and posted-document protection
- **Issues:** SEC-01, SEC-02, SEC-03, SEC-04
- **Business objective:** Stop ordinary staff changing posted records.
- **Root causes:** RC1, RC2
- **Technical solution:** Permission map and check in every posting function; guard trigger on posted tables; narrower read policies; audit insert closed.
- **Frontend:** Small: hide actions without rights, show the server message.
- **Backend / database:** Functions and triggers only.
- **Migration:** Additive migration; redefine functions from the live bodies (line-diff, keep SECURITY DEFINER, search_path, ledger_writer).
- **Security:** Closes SEC-01 to SEC-04.
- **Existing functions affected:** Every posting path; old Android apps that write directly (edit invoice, payments, credit notes) must be listed first.
- **Rollback:** Redeploy previous function bodies; drop triggers.
- **Acceptance criteria:** Run all role tests (S3-S16) and the normal lifecycle (C1-C12) as each role; an accountant can still do all accounting.
- **Automated tests:** One test per function per role; Table-by-table REST tests; Role x table read matrix; Forge test
- **Manual check:** Repeat the steps in document 06 for each issue on web, then in the Android build.

| Step | Issue | Change | Needs |
|---|---|---|---|
| 1 | SEC-01 | Add a permission check at the top of every posting function, from one map (function -> right); keep ledger_writer as owner. | None |
| 2 | SEC-02 | Guard triggers: refuse INSERT with status<>draft, UPDATE/DELETE when OLD.status<>draft, and any status change, unless current_user is ledger_writer. The same pattern alre | SEC-01 |
| 3 | SEC-03 | Restrictive SELECT policies by right; add definer read functions for the few balances those screens need. | Check screens used by those roles |
| 4 | SEC-04 | Drop the client INSERT policy; write from triggers/functions. | Check client writes of audit rows |

## Phase 2: Financial integrity
- **Issues:** PAY-01, PAY-02, PUR-01, PUR-02, SAL-01, SAL-02, SAL-04, ACC-01, ACC-02, ACC-03, ACC-04, ACC-05, HR-01, RPT-01, RPT-02
- **Business objective:** Books always agree.
- **Root causes:** RC3, RC4, RC7
- **Technical solution:** Re-derive amounts, limits, dates and links in functions with row locks; report queries fixed.
- **Frontend:** Messages; VAT, statements, report screens read corrected data.
- **Backend / database:** Functions; adapter report queries.
- **Migration:** Additive. No historic rows changed; existing differences listed for the owner, repaired only by approved documents.
- **Security:** None new.
- **Existing functions affected:** Receipts, payments, invoice void, bills from GRN, journals, opening balances, VAT return, gratuity.
- **Rollback:** Redeploy previous bodies; reports revert with the web build.
- **Acceptance criteria:** E1-E3 pass after the full simulation including D2, D3, D6, D10, D11, D20c, D23, D29, D31b.
- **Automated tests:** Concurrent and over-allocation tests; Void-with-receipt test; Price-variance test; Double-bill test; Damaged return test; Mismatch test; Zero-cost return test; JE control tests; Lock matrix; Mixed-rate VAT test; Filing test; Refusal test; Cap test; Opening test; Opening filter test
- **Manual check:** Repeat the steps in document 06 for each issue on web, then in the Android build.

| Step | Issue | Change | Needs |
|---|---|---|---|
| 1 | PAY-01 | Check applied total against outstanding inside the functions, locking the document row. | None |
| 2 | PAY-02 | Release allocations to on-account (or refuse) inside void_invoice. | PAY-01 |
| 3 | PUR-01 | Post the difference to stock value for quantity on hand and to 5100 for sold quantity (needs Doc 3 rule). | Doc 3 decision |
| 4 | PUR-02 | Refuse when the GRN is billed; unique link per GRN line. | None |
| 5 | SAL-01 | Write off against 1300 with a stock-out, or do not restock damaged lines. AGENTS.md records Dr 6700/Cr 5100, so Doc 3 must be confirmed first. | Doc 3 decision |
| 6 | SAL-02 | Recompute from lines and refuse a mismatch. | None |
| 7 | ACC-01 | Server: force source_type manual for clients; require a party on control accounts; block 1300 except by engines. | SEC-01 |
| 8 | ACC-02 | Add the lock check to every post_opening_* function. | None |
| 9 | ACC-03 | Build boxes from document lines by tax treatment; reconcile to 2200/1500. | None |
| 10 | ACC-04 | Compute inside the function; accept only a matching figure. | ACC-03 |
| 11 | HR-01 | Cap at accrual or post the excess to 6100 with confirmation. | None |
| 12 | RPT-01 | Sum earlier lines as opening. | None |
| 13 | RPT-02 | Filter is_opening. | None |
| 14 | SAL-04 | Take cost from invoice_item_id when empty. | None |
| 15 | ACC-05 | Refuse non-base currency now; full engine later. | None |

## Phase 3: Operations: purchasing, stock, POS, cancellation
- **Issues:** PUR-03, PUR-04, PUR-05, SAL-03, POS-01, POS-02, INV-01, INV-04, PUR-06
- **Business objective:** Daily purchasing, stock and counter work without workarounds.
- **Root causes:** RC3, RC4, RC5
- **Technical solution:** PO states, tolerance, void functions, walk-in customer, count recalculation.
- **Frontend:** PO, GRN, bill, transfer, adjustment, POS screens.
- **Backend / database:** New void functions; settings.
- **Migration:** Additive columns/functions.
- **Security:** New functions use the phase 1 checks.
- **Existing functions affected:** Purchasing and inventory.
- **Rollback:** Switch settings off; redeploy bodies.
- **Acceptance criteria:** C5.5, D1, D4, D9, D15, C7.1c, V-*.
- **Automated tests:** Partial receipt test; Over-receipt test; Duplicate test; Limit test; Walk-in test; No-cost POS test; Stale count test; Void tests; Void bill test
- **Manual check:** Repeat the steps in document 06 for each issue on web, then in the Android build.

| Step | Issue | Change | Needs |
|---|---|---|---|
| 1 | POS-01 | Seed a Walk-in customer per company and use it. | None |
| 2 | PUR-03 | Compare received to ordered quantity. | None |
| 3 | PUR-04 | Tolerance setting, warn or refuse. | PUR-03 |
| 4 | PUR-05 | Server check with a recorded override. | None |
| 5 | SAL-03 | Company setting: warn, approve or block. | Approvals |
| 6 | POS-02 | Always write the stock row. | None |
| 7 | INV-01 | Recompute the difference at confirm, warn if it changed. | None |
| 8 | INV-04 | Reversal functions as for repack. | None |
| 9 | PUR-06 | Add void_vendor_bill. | None |

## Phase 4: Reports and banking control
- **Issues:** ACC-06, BNK-01, BNK-02, RPT-03, RPT-04, RPT-05, RPT-06
- **Business objective:** Management can trust reports.
- **Root causes:** RC3, RC5, RC7
- **Technical solution:** Shared sales, purchase and party facts tied to the ledger.
- **Frontend:** Report screens.
- **Backend / database:** Read functions.
- **Migration:** None or read-only functions.
- **Security:** Respect company and branch.
- **Existing functions affected:** Reports only.
- **Rollback:** Revert web build.
- **Acceptance criteria:** Each report total equals the ledger in an automated test.
- **Automated tests:** Cash flow test; Cash test; Recon test; Report = P&L test; Report test; Aging = 2100 test; PDC health test
- **Manual check:** Repeat the steps in document 06 for each issue on web, then in the Android build.

| Step | Issue | Change | Needs |
|---|---|---|---|
| 1 | ACC-06 | Classify by the journal, not the period net. | None |
| 2 | BNK-01 | Setting: warn bank, block cash. | None |
| 3 | BNK-02 | Check difference = 0 before lock. | None |
| 4 | RPT-03 | One shared sales-facts query with returns. | RPT-02 |
| 5 | RPT-04 | Use subtotal less debit notes. | RPT-02 |
| 6 | RPT-05 | Age by open document like AR. | PAY-01 |
| 7 | RPT-06 | Include 1250/2450 by party. | RPT-05 |

## Phase 5: Hardening and tidy-up
- **Issues:** SEC-05, SEC-06, SAL-05, INV-02, GEN-01, DOC-01, DOC-02
- **Business objective:** Hardening.
- **Root causes:** RC2, RC3, RC4, RC5
- **Technical solution:** Composite references, grants, conflict check, rounding, print SKU, docs.
- **Frontend:** Small.
- **Backend / database:** Constraints after data check.
- **Migration:** Constraints NOT VALID first, then validate.
- **Security:** Improves isolation.
- **Existing functions affected:** Master data.
- **Rollback:** Drop constraints.
- **Acceptance criteria:** S1d, D28b, D30, E4.
- **Automated tests:** Cross-tenant FK test; Grant snapshot test; Inactive product test; Rounding test; Conflict test; Print test
- **Manual check:** Repeat the steps in document 06 for each issue on web, then in the Android build.

| Step | Issue | Change | Needs |
|---|---|---|---|
| 1 | SEC-05 | Composite foreign keys (company_id,id) or a trigger. | Data check first |
| 2 | SAL-05 | Check is_active when confirming a new line. | None |
| 3 | GEN-01 | Send updated_at and refuse if changed. | None |
| 4 | SEC-06 | Revoke unused grants. | None |
| 5 | INV-02 | Keep 6 decimals internally. | Large test |
| 6 | DOC-01 | Pass products to the print adapter. | None |
| 7 | DOC-02 | Fix both. | None |

## Phase 6: Missing modules (each separately approved)
- **Issues:** INV-03, BNK-03, HR-02, HR-03, RPT-07, SO-01, PR-01
- **Business objective:** Complete distribution and HR flow.
- **Root causes:** RC6
- **Technical solution:** New modules, each with its own plan.
- **Frontend:** New screens.
- **Backend / database:** New tables and functions.
- **Migration:** Additive; Doc 2 and Doc 3 updates first.
- **Security:** New rights.
- **Existing functions affected:** None until switched on.
- **Rollback:** Module switch off.
- **Acceptance criteria:** Per module plan.
- **Automated tests:** Loan test
- **Manual check:** Repeat the steps in document 06 for each issue on web, then in the Android build.

| Step | Issue | Change | Needs |
|---|---|---|---|
| 1 | INV-03 | Build with sales orders. | SO-01 |
| 2 | BNK-03 | Import + matching rules. | BNK-02 |
| 3 | HR-02 | Loan screen and functions. | None |
| 4 | HR-03 | Plan as HR phase. | None |
| 5 | RPT-07 | Branch dimension in ledger. | Branch design |
| 6 | SO-01 | Sales order + delivery module. | Doc 3 |
| 7 | PR-01 | Requisition + RFQ. | Approvals |

## Decisions needed before starting
1. PUR-01 and SAL-01: accounting treatment must be agreed in Document 3.
2. PAY-02: refuse voiding a paid invoice, or turn the receipt into customer credit?
3. SEC-03: what may each role read?
4. Whether old Android versions that write directly may be blocked (as in phase155) or must keep working for a period.
5. SEC-02 may have been used on production without anyone knowing; a read-only check of documents against the ledger there needs your approval.
