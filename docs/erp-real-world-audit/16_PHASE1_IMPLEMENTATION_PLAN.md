# 16 Phase 1 plan: role rights and posted-document protection

> Plan only. Nothing is built. Fixes SEC-01, SEC-02, SEC-03, SEC-04. No accounting rule, amount or existing row changes.

## What the investigation found
1. 50 posting functions owned by `ledger_writer` have no permission check (counted on staging). The exact list is taken from the live database before writing SQL.
2. Payroll already has the protection we need (`payroll_runs_lock`, phase131). It refuses direct changes by app users and lets the posting functions (owner `ledger_writer`) through. Phase 1 copies this proven pattern.
3. **One screen would break:** editing a confirmed invoice. The app first writes the confirmed invoice and its lines directly, then calls `edit_invoice`. If the second step fails today, the invoice and its accounts already disagree. Bills, payments, credit/debit notes and expenses go back to draft first, so they are safe.
4. Approvals call the confirm functions as the approver, who may not hold the module right. Those calls must stay allowed.
5. 20 or so functions and triggers call `post_journal_entry` internally (credit-note write-off, depreciation and others). A check placed simply at its top would stop, for example, a sales user's credit note.

## Step 1 (phase158) Permission checks
**New internal helper** `_require_any(rights[])`: passes if the caller holds one right; otherwise "You do not have permission to do this". Because it uses `has_perm`, inactive users and read-only companies are refused as well.

**Internal and public versions.** The current body of each function that is called by another one moves unchanged to an internal function no app user can call. The public name stays, checks the right, then calls it. Approvals and internal callers use the internal one. Name, arguments and results do not change, so existing apps keep working.

| Functions | Right needed (any one) |
|---|---|
| confirm/edit invoice, confirm/reopen credit note | sales.write |
| void invoice, void credit note, fee/write-off reversal | sales.write or accounting.write |
| confirm/reopen/void customer payment, apply advance, customer PDC | sales.write or accounting.write |
| confirm_pos_sale | sales.write |
| confirm/edit bill, confirm/reopen/void debit note | purchasing.write |
| vendor payment, vendor advance, vendor PDC | purchasing.write or accounting.write |
| confirm GRN | purchasing.write or inventory.write |
| expense confirm/reopen/void | purchasing.write or accounting.write |
| transfer, adjustment | inventory.write |
| opening stock post/void | inventory.write or accounting.write |
| journals, reversal, opening balances, bank transfer, cheque clear/bounce/cancel, bill repair | accounting.write |
| payroll, leave salary, gratuity | payroll.write (admin) |
| recompute valuation, reset data | settings.write |
| functions shared by both payment sides | decided by the payment type |

Today's built-in roles keep their work: the accountant holds purchasing and accounting rights, counter and sales hold sales.write. **Change to note:** an accountant could confirm a sales invoice through the API; not from now on, unless you say so (decision 1).

## Step 2 (phase159) Invoice edit in one step
New `save_invoice_edit(invoice, header, lines)`: checks the right, period lock, returns and packs, replaces header and lines and re-posts in **one transaction**, using the existing `edit_invoice` logic unchanged. If anything fails, nothing changes. The web and app switch to it.

Old apps (1.0.26 and older): editing a confirmed invoice would fail with "Please update StockBolt". Nothing else stops. Creating, confirming and voiding still work.

## Step 3 (phase160) Posted documents are locked
One trigger function, attached to: invoices, vendor bills, payments, credit notes, debit notes, expenses, sales and purchase returns, goods receipts, transfers, adjustments, bank transfers, leave salary, POS sessions (closing figures), repacks, their line tables, landed costs, payment allocations.

For app users only:
- insert must be `draft` (POS sessions: `open`);
- no update of a document that is not draft; no status change at all;
- no delete unless draft; lines follow their document;
- allocations only for a draft payment.

Allowed on a posted document: notes, reference, due date, salesperson and project, if a screen really does it today (to be confirmed per field before writing). Purchase orders and quotes are not posted, so they keep free status changes.

Posting functions, admin tools, company reset and the delete-company tool pass because they run as ledger_writer or postgres. **Fixed assets and amortization** are posted records too, but their screens edit active rows; this step only freezes cost, dates, accounts and accumulated figures after the first depreciation.

## Step 4 (phase161) Audit log
Remove the client INSERT policy. Only the database writes it. The app has no direct audit insert (checked); it only reads.

## Step 5 (phase162) Who may read what
| Data | Right to read |
|---|---|
| general_ledger, journal_entries | accounting.read or reports.read |
| vendor_bills, lines, debit notes, purchase orders, GRN | purchasing.read |
| expenses | purchasing.read or accounting.read |
| bank_accounts (name list for receipts) | any writer or reader of sales, purchasing, accounting; balances come from the ledger |
| payments | inbound: sales.read; outbound: purchasing.read; both: accounting.read |

Sales and counter screens that use the ledger today (customer balance on the invoice, dashboard figures, project profit) need small read functions first, or they would show zero. **This step has the most screen risk and goes last, in its own release.** The sales role holds reports.read today, so its general ledger access would continue unless decision 2 says otherwise.

## Order and release

| Release | Contents | Web | App | SQL |
|---|---|---|---|---|
| 1A | Steps 1 and 4 | Not needed | Not needed | 158, 161 |
| 1B | Step 2 | Yes | 1.0.28 (code 29) | 159 before the web |
| 1C | Step 3 | No | Wait until users are on 1.0.28, or accept the invoice-edit message | 160 |
| 1D | Step 5 | Yes | 1.0.29 (code 30) | 162 |

The phase numbers are planned names; they follow the last one used (157). Each is additive. Until 1C, a sales user could still change posted records through the API.

## Before applying
1. Read live function definitions and fingerprints from production; patch those, never an old file. Keep SECURITY DEFINER, search_path, owner and grants.
2. Read-only check on production (you run it): confirmed documents with no journal, journals with no document, document total not equal to its journal, draft documents with journals, payments confirmed without posting. This shows whether SEC-02 was ever used; it changes nothing. Existing mismatches are not blocked by the triggers, but may not be editable later, so they are listed first.
3. Snapshot and full run on local staging.

## Tests
- Every function x every role (owner, accountant, sales, counter, viewer, warehouse, purchase, inactive, read-only company): allowed only as the table says.
- Every posted table: insert confirmed, update, status change, delete, line change: refused; draft work allowed.
- The whole audit simulation again: all 107 passing checks still pass; S5, S8, S10, S11, S12, S13, D29c and (1D) S4, S7 turn green.
- Screens: create, confirm, edit, void, reopen and delete draft for each document; POS; approvals by an approver without module rights; asset purchase and its edit; opening balance edit; returns; import; API draft intake; reset data; delete company.
- Old app simulation: the old adapter against the new database; only the invoice edit may differ.
- Ledger lines of existing staging documents are identical before and after.
- Web, phone, Arabic; unit, type, lint.

## Rollback
1A and 1B: redeploy the previous function bodies (saved before release). 1C: one statement per table drops the trigger. 1D: drop the new read policies. No data is changed, so nothing needs repair.

## Risks
| Risk | Protection |
|---|---|
| A legitimate user is blocked | Role matrix test; message names the problem; the owner can grant the right in Users and roles |
| A custom role used a function without its right | Read-only list of custom roles and overrides on production first |
| A hidden direct write | Every direct write in the adapter is mapped; whole-screen test before 1C |
| Approval, POS or asset purchase stops | Internal versions; dedicated tests |
| Old phones | Only editing a confirmed invoice; message to update |

## Decisions needed
1. May an accountant confirm or edit sales invoices? (Plan: void only.)
2. Should the Sales role keep seeing reports built from the ledger? (Plan: yes, reports only.)
3. May a warehouse user confirm goods receipts? (Plan: yes.)
4. Release 1C straight after 1.0.28 is on Play, or wait some weeks? (Plan: wait two weeks.)
5. May I prepare the read-only production check?

Effort: 1A medium, 1B medium, 1C high, 1D high. The other audit phases are not part of this plan.
