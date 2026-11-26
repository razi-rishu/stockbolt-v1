# 06 Detailed issue register

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

| ID | Severity | Module | Type |
|---|---|---|---|
| SEC-01 | P0 | Security / Accounting | Confirmed defect |
| SEC-02 | P0 | Sales / Purchasing / Payments | Confirmed defect |
| ACC-01 | P1 | Accounting | Confirmed defect |
| ACC-02 | P1 | Accounting | Confirmed defect |
| ACC-03 | P1 | Tax | Confirmed defect |
| ACC-04 | P1 | Tax | Confirmed defect |
| HR-01 | P1 | Payroll | Confirmed defect |
| PAY-01 | P1 | Payments | Confirmed defect |
| PAY-02 | P1 | Sales | Confirmed defect |
| POS-01 | P1 | POS | Confirmed defect |
| PUR-01 | P1 | Purchasing | Confirmed defect |
| PUR-02 | P1 | Purchasing | Confirmed defect |
| RPT-01 | P1 | Reports | Confirmed defect |
| RPT-02 | P1 | Reports | Confirmed defect |
| SAL-01 | P1 | Sales | Confirmed defect |
| SAL-02 | P1 | Sales | Confirmed defect |
| SEC-03 | P1 | Security | Confirmed defect |
| SEC-04 | P1 | Audit | Confirmed defect |
| ACC-05 | P2 | Accounting | Design limitation |
| ACC-06 | P2 | Reports | Potential risk |
| BNK-01 | P2 | Banking | Design limitation |
| BNK-02 | P2 | Banking | Confirmed defect |
| BNK-03 | P2 | Banking | Missing feature |
| GEN-01 | P2 | All | Design limitation |
| HR-02 | P2 | Payroll | Missing feature |
| HR-03 | P2 | HR | Missing feature |
| INV-01 | P2 | Inventory | Confirmed defect |
| INV-03 | P2 | Inventory | Missing feature |
| INV-04 | P2 | Inventory | Missing feature |
| POS-02 | P2 | POS | Confirmed defect |
| PR-01 | P2 | Purchasing | Missing feature |
| PUR-03 | P2 | Purchasing | Confirmed defect |
| PUR-04 | P2 | Purchasing | Confirmed defect |
| PUR-05 | P2 | Purchasing | Design limitation |
| PUR-06 | P2 | Purchasing | Design limitation |
| RPT-03 | P2 | Reports | Confirmed defect |
| RPT-04 | P2 | Reports | Confirmed defect |
| RPT-05 | P2 | Reports | Confirmed defect |
| RPT-06 | P2 | System health | Confirmed defect |
| RPT-07 | P2 | Reports | Missing feature |
| SAL-03 | P2 | Sales | Design limitation |
| SAL-04 | P2 | Sales | Potential risk |
| SAL-05 | P2 | Sales | Confirmed defect |
| SEC-05 | P2 | Security | Potential risk |
| SO-01 | P2 | Sales | Missing feature |
| DOC-01 | P3 | Print | Confirmed defect |
| DOC-02 | P3 | Tests / docs | Confirmed defect |
| INV-02 | P3 | Inventory | Design limitation |
| SEC-06 | P3 | Security | Potential risk |

## SEC-01 (P0, Confirmed defect)
- **Module:** Security / Accounting
- **Business workflow:** Posting permission
- **Problem:** Most posting functions check only that the caller belongs to the company, not that the caller holds the right. Any user with any write right can post.
- **Steps:** Sign in as a Sales, Counter, Warehouse or Purchase user; call post_journal_entry, confirm_expense, void_payment, confirm_invoice, post_opening_stock, post_gl_opening_balance or reverse_journal_entry through the API.
- **Expected:** Refused: the function needs accounting.write (or the matching right).
- **Actual:** Allowed. Journals, expenses, opening stock, GL openings, receipt voids and reversal of a supplier-bill journal were all posted. Viewer is blocked only because row security stops document_sequences.
- **Technical evidence:** S5-sales/counter/wh/pu, S8-sales/counter/wh, S10-wh/pu, S11, S11b, S11c
- **Source files:** src/App.tsx (route gates only), src/data/supabaseAdapter.ts
- **Database:** post_journal_entry, reverse_journal_entry, confirm_* / void_* / reopen_* / edit_*, post_opening_*, has_perm
- **Business impact:** A cashier can move money or erase a receipt.
- **Financial impact:** Any ledger figure can be changed by a non-finance user.
- **Recommended solution:** Add a permission check at the top of every posting function, from one map (function -> right); keep ledger_writer as owner.
- **Dependencies:** None
- **Regression test:** One test per function per role
- **Root cause:** RC1 Permission is checked by screens, not by the database functions
- **Roadmap phase:** 1

## SEC-02 (P0, Confirmed defect)
- **Module:** Sales / Purchasing / Payments
- **Business workflow:** Document integrity
- **Problem:** Confirmed documents can be changed or deleted directly through the table API, and drafts can be marked confirmed without posting.
- **Steps:** As a Sales user: PATCH invoices total_amount/status/date, PATCH invoice_items, POST payments status=confirmed, DELETE a confirmed invoice. As Purchase user PATCH vendor_bills.
- **Expected:** Refused once status is not draft; status changes only through the posting functions.
- **Actual:** All allowed. A deleted confirmed invoice left its journal behind. A confirmed invoice was moved into a closed period.
- **Technical evidence:** S12, S12b, S12c, S12d, S12e, S12f, S12h, D29c
- **Source files:** src/data/supabaseAdapter.ts
- **Database:** invoices, invoice_items, vendor_bills, vendor_bill_items, payments, payment_allocations, credit_notes, debit_notes, expenses (no status guard trigger)
- **Business impact:** Documents stop matching the ledger without trace.
- **Financial impact:** AR, AP, sales, VAT document totals can be falsified.
- **Recommended solution:** Guard triggers: refuse INSERT with status<>draft, UPDATE/DELETE when OLD.status<>draft, and any status change, unless current_user is ledger_writer. The same pattern already protects asset-purchase bills (phase137).
- **Dependencies:** SEC-01
- **Regression test:** Table-by-table REST tests
- **Root cause:** RC2 Tables stay open for direct writes after posting
- **Roadmap phase:** 1

## ACC-01 (P1, Confirmed defect)
- **Module:** Accounting
- **Business workflow:** Manual journal
- **Problem:** Manual journals can post to 1200/2100 without a party, to 1300, and can be labelled sales_invoice.
- **Steps:** Post such journals.
- **Expected:** Refused or restricted.
- **Actual:** Accepted; AR and stock checks then fail.
- **Technical evidence:** D23, D23b, D23c, E3 (B3)
- **Source files:** src/modules/accounting/journal-entry-editor.tsx:172 (warns only)
- **Database:** post_journal_entry
- **Business impact:** Subledgers stop agreeing.
- **Financial impact:** B1, E1, B3 failures
- **Recommended solution:** Server: force source_type manual for clients; require a party on control accounts; block 1300 except by engines.
- **Dependencies:** SEC-01
- **Regression test:** JE control tests
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 2

## ACC-02 (P1, Confirmed defect)
- **Module:** Accounting
- **Business workflow:** Period lock
- **Problem:** Opening stock and opening balances post into a locked period.
- **Steps:** Lock to 31 Oct; post opening dated October.
- **Expected:** Refused.
- **Actual:** Accepted. Journal, invoice, expense and depreciation are refused.
- **Technical evidence:** D29
- **Source files:** src/modules/settings/opening-balances.tsx
- **Database:** post_opening_stock, post_opening_balance
- **Business impact:** Closed figures change.
- **Financial impact:** Filed periods change
- **Recommended solution:** Add the lock check to every post_opening_* function.
- **Dependencies:** None
- **Regression test:** Lock matrix
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 2

## ACC-03 (P1, Confirmed defect)
- **Module:** Tax
- **Business workflow:** UAE VAT Return
- **Problem:** Taxable amounts are all of account 4100 and cost of goods sold 5100. VAT amounts are right.
- **Steps:** Run the report with no-VAT sales and unsold purchases.
- **Expected:** Taxable sales/purchases by treatment.
- **Actual:** Expenses base 122.71 shown instead of purchases; zero-rated and exempt always 0.
- **Technical evidence:** R-VAT, KG test 2026-11-25
- **Source files:** src/data/supabaseAdapter.ts:4757
- **Database:** general_ledger
- **Business impact:** Wrong tax return.
- **Financial impact:** Wrong boxes filed
- **Recommended solution:** Build boxes from document lines by tax treatment; reconcile to 2200/1500.
- **Dependencies:** None
- **Regression test:** Mixed-rate VAT test
- **Root cause:** RC7 Each report has its own query over documents or ledger
- **Roadmap phase:** 2

## ACC-04 (P1, Confirmed defect)
- **Module:** Tax
- **Business workflow:** Filing
- **Problem:** A return can be filed with figures that do not match the books.
- **Steps:** file_tax_return with 999.
- **Expected:** Server recomputes or refuses.
- **Actual:** Filed.
- **Technical evidence:** C12.3-quarterly, C12.3-monthly
- **Source files:** src/modules/accounting
- **Database:** file_tax_return
- **Business impact:** Wrong filed record.
- **Financial impact:** Tax
- **Recommended solution:** Compute inside the function; accept only a matching figure.
- **Dependencies:** ACC-03
- **Regression test:** Filing test
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 2

## HR-01 (P1, Confirmed defect)
- **Module:** Payroll
- **Business workflow:** Gratuity
- **Problem:** Gratuity can be settled above what is accrued.
- **Steps:** Settle 500,000 for an employee.
- **Expected:** Refused or difference expensed.
- **Actual:** Paid; 2360 became a 499,625 debit.
- **Technical evidence:** C9.8b
- **Source files:** src/modules/payroll/employees.tsx
- **Database:** settle_gratuity
- **Business impact:** Large wrong payment.
- **Financial impact:** Liability account wrong
- **Recommended solution:** Cap at accrual or post the excess to 6100 with confirmation.
- **Dependencies:** None
- **Regression test:** Cap test
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 2

## PAY-01 (P1, Confirmed defect)
- **Module:** Payments
- **Business workflow:** Allocation
- **Problem:** The server lets a payment be applied for more than is due, more than once.
- **Steps:** Allocate 10,000 to a 504 bill; pay a paid invoice again; confirm two receipts of 210 for the same invoice at once.
- **Expected:** Refused.
- **Actual:** All accepted. The screen checks, but two users at once or the API pass.
- **Technical evidence:** D6, D10, D11
- **Source files:** src/modules/sales/payment-editor.tsx:315
- **Database:** confirm_payment, confirm_vendor_payment, payment_allocations
- **Business impact:** Customers and suppliers look overpaid.
- **Financial impact:** AR/AP negative balances.
- **Recommended solution:** Check applied total against outstanding inside the functions, locking the document row.
- **Dependencies:** None
- **Regression test:** Concurrent and over-allocation tests
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 2

## PAY-02 (P1, Confirmed defect)
- **Module:** Sales
- **Business workflow:** Cancel invoice
- **Problem:** Voiding an invoice that has a confirmed receipt leaves the receipt fully allocated to the void invoice.
- **Steps:** Invoice 105, receipt 105, void invoice.
- **Expected:** Void refused, or the receipt becomes customer credit.
- **Actual:** Voided; 1 allocation left, payment still "full/against_invoice". AR then differs from aging.
- **Technical evidence:** D20c, D20b, E3 (B1)
- **Source files:** -
- **Database:** void_invoice
- **Business impact:** Customer credit is hidden.
- **Financial impact:** AR aging does not equal account 1200.
- **Recommended solution:** Release allocations to on-account (or refuse) inside void_invoice.
- **Dependencies:** PAY-01
- **Regression test:** Void-with-receipt test
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 2

## POS-01 (P1, Confirmed defect)
- **Module:** POS
- **Business workflow:** Walk-in sale
- **Problem:** Cash/card sale without a customer fails.
- **Steps:** Confirm a POS sale with no customer.
- **Expected:** Sold to walk-in customer.
- **Actual:** Error: contact_id is required.
- **Technical evidence:** C7.1c
- **Source files:** src/modules/pos/pos-screen.tsx
- **Database:** confirm_pos_sale, invoices.contact_id
- **Business impact:** Counter sales need a customer every time.
- **Financial impact:** None
- **Recommended solution:** Seed a Walk-in customer per company and use it.
- **Dependencies:** None
- **Regression test:** Walk-in test
- **Root cause:** RC5 Workflow built for the normal path only
- **Roadmap phase:** 3

## PUR-01 (P1, Confirmed defect)
- **Module:** Purchasing
- **Business workflow:** GRN to bill price difference
- **Problem:** A bill priced differently from its goods receipt changes account 1300 but not stock value.
- **Steps:** Receive 40 at 8, bill 40 at 9.
- **Expected:** Difference updates stock value or goes to a variance account.
- **Actual:** 1300 = 2,357.50, stock ledger = 2,317.50.
- **Technical evidence:** D2, E2, E3 (E1)
- **Source files:** src/modules/purchasing/vendor-bill-editor.tsx
- **Database:** confirm_vendor_bill
- **Business impact:** Stock report disagrees with the balance sheet.
- **Financial impact:** Permanent E1 difference per bill.
- **Recommended solution:** Post the difference to stock value for quantity on hand and to 5100 for sold quantity (needs Doc 3 rule).
- **Dependencies:** Doc 3 decision
- **Regression test:** Price-variance test
- **Root cause:** RC4 Cost flow is incomplete for corrections
- **Roadmap phase:** 2

## PUR-02 (P1, Confirmed defect)
- **Module:** Purchasing
- **Business workflow:** GRN billing
- **Problem:** The same goods receipt can be billed twice.
- **Steps:** Confirm two bills linked to one GRN.
- **Expected:** Refused.
- **Actual:** Accepted; GRN accrual 2150 over-cleared.
- **Technical evidence:** D3
- **Source files:** src/modules/purchasing/vendor-bill-editor.tsx
- **Database:** confirm_vendor_bill, goods_receipts.status
- **Business impact:** Supplier paid twice.
- **Financial impact:** AP overstated.
- **Recommended solution:** Refuse when the GRN is billed; unique link per GRN line.
- **Dependencies:** None
- **Regression test:** Double-bill test
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 2

## RPT-01 (P1, Confirmed defect)
- **Module:** Reports
- **Business workflow:** Statements
- **Problem:** Supplier and customer statements ignore the opening balance.
- **Steps:** Run November with older balances.
- **Expected:** Opening shown.
- **Actual:** opening_balance 0 in both; closing wrong.
- **Technical evidence:** R-SST, R-CST
- **Source files:** src/data/supabaseAdapter.ts:3843, :3956
- **Database:** general_ledger
- **Business impact:** Wrong statements sent out.
- **Financial impact:** Balance shown wrong
- **Recommended solution:** Sum earlier lines as opening.
- **Dependencies:** None
- **Regression test:** Opening test
- **Root cause:** RC7 Each report has its own query over documents or ledger
- **Roadmap phase:** 2

## RPT-02 (P1, Confirmed defect)
- **Module:** Reports
- **Business workflow:** Sales and purchase reports
- **Problem:** Opening balances count as sales and purchases.
- **Steps:** Post opening AR 1,000; run Sales by Customer.
- **Expected:** Excluded.
- **Actual:** Customer 1 shows 1,000 sales, 100% profit.
- **Technical evidence:** R-SBC, R-PBS
- **Source files:** src/data/supabaseAdapter.ts:4361, :4684
- **Database:** invoices.is_opening, vendor_bills.is_opening
- **Business impact:** Wrong performance.
- **Financial impact:** Differs from P&L
- **Recommended solution:** Filter is_opening.
- **Dependencies:** None
- **Regression test:** Opening filter test
- **Root cause:** RC7 Each report has its own query over documents or ledger
- **Roadmap phase:** 2

## SAL-01 (P1, Confirmed defect)
- **Module:** Sales
- **Business workflow:** Damaged return
- **Problem:** A damaged return goes back into sellable stock at full value; the write-off only moves the amount from 5100 to 6700.
- **Steps:** Return 1 damaged unit.
- **Expected:** Stock not increased (or moved to a damaged location); loss recognised.
- **Actual:** Stock 77 to 78; 6700 +9.70, 5100 -9.70, net loss nil.
- **Technical evidence:** D17r
- **Source files:** src/modules/sales/credit-note-editor.tsx
- **Database:** confirm_credit_note, post_credit_note_writeoff (Dr 6700 / Cr 5100)
- **Business impact:** Damaged goods can be sold again.
- **Financial impact:** Inventory and profit overstated.
- **Recommended solution:** Write off against 1300 with a stock-out, or do not restock damaged lines. AGENTS.md records Dr 6700/Cr 5100, so Doc 3 must be confirmed first.
- **Dependencies:** Doc 3 decision
- **Regression test:** Damaged return test
- **Root cause:** RC4 Cost flow is incomplete for corrections
- **Roadmap phase:** 2

## SAL-02 (P1, Confirmed defect)
- **Module:** Sales
- **Business workflow:** Invoice totals
- **Problem:** Invoice header total is not checked against its lines.
- **Steps:** Header 500, one line of 5; confirm.
- **Expected:** Refused (the bill side refuses).
- **Actual:** Posted.
- **Technical evidence:** D31b, D31
- **Source files:** -
- **Database:** confirm_invoice
- **Business impact:** Wrong amount billed if a client fails mid-save.
- **Financial impact:** AR and revenue not equal to lines.
- **Recommended solution:** Recompute from lines and refuse a mismatch.
- **Dependencies:** None
- **Regression test:** Mismatch test
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 2

## SEC-03 (P1, Confirmed defect)
- **Module:** Security
- **Business workflow:** Reading financial data
- **Problem:** Sales, Counter and Warehouse users can read the general ledger, supplier bills, expenses, bank accounts and payments through the API.
- **Steps:** Sign in as Counter and select general_ledger.
- **Expected:** No rows without accounting.read / purchasing.read.
- **Actual:** Rows returned. Salaries are correctly blocked.
- **Technical evidence:** S4-*, S7-*
- **Source files:** src/lib/permissions.ts
- **Database:** general_ledger, journal_entries, vendor_bills, expenses, bank_accounts SELECT policies
- **Business impact:** Staff can see profit, suppliers and bank balances.
- **Financial impact:** Confidentiality only.
- **Recommended solution:** Restrictive SELECT policies by right; add definer read functions for the few balances those screens need.
- **Dependencies:** Check screens used by those roles
- **Regression test:** Role x table read matrix
- **Root cause:** RC1 Permission is checked by screens, not by the database functions
- **Roadmap phase:** 1

## SEC-04 (P1, Confirmed defect)
- **Module:** Audit
- **Business workflow:** Audit log
- **Problem:** Any signed-in user can insert audit rows, with user_id empty.
- **Steps:** POST audit_logs as Sales.
- **Expected:** Only the database writes the log.
- **Actual:** Row accepted. Deleting rows is refused.
- **Technical evidence:** S13
- **Source files:** -
- **Database:** audit_logs_insert policy
- **Business impact:** Audit trail can be polluted.
- **Financial impact:** None direct
- **Recommended solution:** Drop the client INSERT policy; write from triggers/functions.
- **Dependencies:** Check client writes of audit rows
- **Regression test:** Forge test
- **Root cause:** RC2 Tables stay open for direct writes after posting
- **Roadmap phase:** 1

## ACC-05 (P2, Design limitation)
- **Module:** Accounting
- **Business workflow:** Multi-currency
- **Problem:** Foreign amounts post unconverted if a document carries another currency. The screen locks base currency.
- **Steps:** API invoice USD 100 at 3.67.
- **Expected:** 367.
- **Actual:** 100.
- **Technical evidence:** D27
- **Source files:** docs/MULTICURRENCY_AUDIT.md
- **Database:** posting functions
- **Business impact:** Multi-currency cannot be used.
- **Financial impact:** Understated AR
- **Recommended solution:** Refuse non-base currency now; full engine later.
- **Dependencies:** None
- **Regression test:** Refusal test
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 2

## ACC-06 (P2, Potential risk)
- **Module:** Reports
- **Business workflow:** Cash flow
- **Problem:** Asset buying and sale proceeds in the period appeared under operating, investing was empty (total cash agrees).
- **Steps:** Buy 1,200, sell 900 in one period.
- **Expected:** Investing -300.
- **Actual:** Investing 0.
- **Technical evidence:** R-CF
- **Source files:** src/data/supabaseAdapter.ts:5128
- **Database:** general_ledger
- **Business impact:** Wrong classification.
- **Financial impact:** Presentation
- **Recommended solution:** Classify by the journal, not the period net.
- **Dependencies:** None
- **Regression test:** Cash flow test
- **Root cause:** RC7 Each report has its own query over documents or ledger
- **Roadmap phase:** 4

## BNK-01 (P2, Design limitation)
- **Module:** Banking
- **Business workflow:** Overdraft
- **Problem:** A bank or cash account can go far below zero.
- **Steps:** Transfer 999,999 from cash.
- **Expected:** Warning / cash block.
- **Actual:** Posted.
- **Technical evidence:** D24
- **Source files:** src/modules/banking
- **Database:** confirm_bank_transfer
- **Business impact:** Impossible cash.
- **Financial impact:** G2
- **Recommended solution:** Setting: warn bank, block cash.
- **Dependencies:** None
- **Regression test:** Cash test
- **Root cause:** RC5 Workflow built for the normal path only
- **Roadmap phase:** 4

## BNK-02 (P2, Confirmed defect)
- **Module:** Banking
- **Business workflow:** Reconciliation
- **Problem:** A reconciliation that does not agree can be locked.
- **Steps:** Close at 100 when matched total differs.
- **Expected:** Refused.
- **Actual:** Saved and locked.
- **Technical evidence:** C10.5
- **Source files:** src/modules/banking
- **Database:** save_bank_reconciliation
- **Business impact:** False reconciliation.
- **Financial impact:** None
- **Recommended solution:** Check difference = 0 before lock.
- **Dependencies:** None
- **Regression test:** Recon test
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 4

## BNK-03 (P2, Missing feature)
- **Module:** Banking
- **Business workflow:** Statement import
- **Problem:** No bank statement import or auto-matching.
- **Steps:** Look for import.
- **Expected:** CSV/OFX import.
- **Actual:** Not implemented.
- **Technical evidence:** Code review
- **Source files:** src/modules/banking
- **Database:** bank_reconciliations
- **Business impact:** Manual ticking.
- **Financial impact:** None
- **Recommended solution:** Import + matching rules.
- **Dependencies:** BNK-02
- **Regression test:** -
- **Root cause:** RC6 Module not built
- **Roadmap phase:** 6

## GEN-01 (P2, Design limitation)
- **Module:** All
- **Business workflow:** Concurrency
- **Problem:** Two users editing one draft: last save wins silently.
- **Steps:** Both save.
- **Expected:** Second warned.
- **Actual:** Accepted.
- **Technical evidence:** D30
- **Source files:** -
- **Database:** updated_at not checked
- **Business impact:** Lost edits.
- **Financial impact:** Possible
- **Recommended solution:** Send updated_at and refuse if changed.
- **Dependencies:** None
- **Regression test:** Conflict test
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 5

## HR-02 (P2, Missing feature)
- **Module:** Payroll
- **Business workflow:** Employee advances
- **Problem:** The loans table exists, but there is no screen and no posting to 1450.
- **Steps:** Insert a loan.
- **Expected:** Dr 1450 / Cr bank.
- **Actual:** No posting.
- **Technical evidence:** C8.14
- **Source files:** src/lib/backup-manifest.ts only
- **Database:** employee_loans
- **Business impact:** Advances kept outside the ERP.
- **Financial impact:** None
- **Recommended solution:** Loan screen and functions.
- **Dependencies:** None
- **Regression test:** Loan test
- **Root cause:** RC6 Module not built
- **Roadmap phase:** 6

## HR-03 (P2, Missing feature)
- **Module:** HR
- **Business workflow:** Attendance and leave
- **Problem:** No attendance, leave requests, leave policy or payroll approval; leave salary payout only.
- **Steps:** Look for screens.
- **Expected:** Attendance to payroll.
- **Actual:** Not implemented.
- **Technical evidence:** Route list
- **Source files:** src/modules/payroll
- **Database:** none
- **Business impact:** Manual HR.
- **Financial impact:** None
- **Recommended solution:** Plan as HR phase.
- **Dependencies:** None
- **Regression test:** -
- **Root cause:** RC6 Module not built
- **Roadmap phase:** 6

## INV-01 (P2, Confirmed defect)
- **Module:** Inventory
- **Business workflow:** Stock count
- **Problem:** A count saves the difference from the quantity seen at entry, not the current quantity.
- **Steps:** Item has 79; count document says system 10, actual 12; confirm.
- **Expected:** Stock 12, or a warning that stock changed.
- **Actual:** Stock 81.
- **Technical evidence:** D9
- **Source files:** src/modules/inventory/adjustment-editor.tsx
- **Database:** confirm_inventory_adjustment
- **Business impact:** Counts during trading give wrong stock.
- **Financial impact:** Inventory misstated
- **Recommended solution:** Recompute the difference at confirm, warn if it changed.
- **Dependencies:** None
- **Regression test:** Stale count test
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 3

## INV-03 (P2, Missing feature)
- **Module:** Inventory
- **Business workflow:** Reservation
- **Problem:** No stock reservation and no available-versus-on-hand.
- **Steps:** Look for reservation.
- **Expected:** Reserve on order.
- **Actual:** Not implemented.
- **Technical evidence:** Schema review
- **Source files:** -
- **Database:** none
- **Business impact:** Overselling between order and delivery.
- **Financial impact:** None
- **Recommended solution:** Build with sales orders.
- **Dependencies:** SO-01
- **Regression test:** -
- **Root cause:** RC6 Module not built
- **Roadmap phase:** 6

## INV-04 (P2, Missing feature)
- **Module:** Inventory
- **Business workflow:** Cancel
- **Problem:** No void for transfers, adjustments or goods receipts.
- **Steps:** Look for a void function.
- **Expected:** Void with reversal.
- **Actual:** Not implemented.
- **Technical evidence:** V-*
- **Source files:** src/modules/inventory
- **Database:** no void_stock_transfer / void_inventory_adjustment / void_grn
- **Business impact:** Mistakes need opposite documents.
- **Financial impact:** None
- **Recommended solution:** Reversal functions as for repack.
- **Dependencies:** None
- **Regression test:** Void tests
- **Root cause:** RC5 Workflow built for the normal path only
- **Roadmap phase:** 3

## POS-02 (P2, Confirmed defect)
- **Module:** POS
- **Business workflow:** No-cost item
- **Problem:** POS sale of an item without cost leaves stock unchanged (found 2026-11-24, not retested).
- **Steps:** Sell an item with no cost.
- **Expected:** Stock falls.
- **Actual:** Unchanged.
- **Technical evidence:** Memory: costing findings 2026-11-24
- **Source files:** -
- **Database:** confirm_pos_sale
- **Business impact:** Wrong stock.
- **Financial impact:** E1
- **Recommended solution:** Always write the stock row.
- **Dependencies:** None
- **Regression test:** No-cost POS test
- **Root cause:** RC4 Cost flow is incomplete for corrections
- **Roadmap phase:** 3

## PR-01 (P2, Missing feature)
- **Module:** Purchasing
- **Business workflow:** Requisition
- **Problem:** No purchase request, supplier quotation or comparison.
- **Steps:** Look for screens.
- **Expected:** Available.
- **Actual:** Not implemented.
- **Technical evidence:** Route list
- **Source files:** src/modules/purchasing
- **Database:** none
- **Business impact:** Done outside.
- **Financial impact:** None
- **Recommended solution:** Requisition + RFQ.
- **Dependencies:** Approvals
- **Regression test:** -
- **Root cause:** RC6 Module not built
- **Roadmap phase:** 6

## PUR-03 (P2, Confirmed defect)
- **Module:** Purchasing
- **Business workflow:** Partial receipt
- **Problem:** A purchase order becomes Received at the first partial receipt, so the rest disappears from Outstanding POs.
- **Steps:** Order 100, receive 60.
- **Expected:** Partially received.
- **Actual:** Received.
- **Technical evidence:** C5.5
- **Source files:** src/modules/purchasing/grn-editor.tsx
- **Database:** confirm_grn (always sets received)
- **Business impact:** Buyers lose track of pending goods.
- **Financial impact:** None
- **Recommended solution:** Compare received to ordered quantity.
- **Dependencies:** None
- **Regression test:** Partial receipt test
- **Root cause:** RC5 Workflow built for the normal path only
- **Roadmap phase:** 3

## PUR-04 (P2, Confirmed defect)
- **Module:** Purchasing
- **Business workflow:** Over-receipt
- **Problem:** More than ordered can be received without warning.
- **Steps:** Order 100, receive 130.
- **Expected:** Warning or tolerance.
- **Actual:** Accepted.
- **Technical evidence:** D1
- **Source files:** src/modules/purchasing/grn-editor.tsx
- **Database:** confirm_grn
- **Business impact:** Unordered goods accepted.
- **Financial impact:** Higher accrual
- **Recommended solution:** Tolerance setting, warn or refuse.
- **Dependencies:** PUR-03
- **Regression test:** Over-receipt test
- **Root cause:** RC5 Workflow built for the normal path only
- **Roadmap phase:** 3

## PUR-05 (P2, Design limitation)
- **Module:** Purchasing
- **Business workflow:** Duplicate supplier invoice
- **Problem:** Same supplier bill number accepted twice by the server (screen only warns).
- **Steps:** Two bills with supplier number S-1.
- **Expected:** Refused or explicit override.
- **Actual:** Accepted.
- **Technical evidence:** D4
- **Source files:** src/ui/duplicate-warning.tsx
- **Database:** vendor_bills.supplier_bill_number
- **Business impact:** Double payment risk.
- **Financial impact:** AP overstated
- **Recommended solution:** Server check with a recorded override.
- **Dependencies:** None
- **Regression test:** Duplicate test
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 3

## PUR-06 (P2, Design limitation)
- **Module:** Purchasing
- **Business workflow:** Cancel bill
- **Problem:** No Void for bills: a bill is reopened and the draft deleted, losing its number and trail.
- **Steps:** Open a confirmed bill.
- **Expected:** Void keeps the record.
- **Actual:** Reopen + delete only.
- **Technical evidence:** V-void_vendor_bill
- **Source files:** src/modules/purchasing/vendor-bill-editor.tsx
- **Database:** edit_vendor_bill
- **Business impact:** Gap in bill numbers.
- **Financial impact:** None
- **Recommended solution:** Add void_vendor_bill.
- **Dependencies:** None
- **Regression test:** Void bill test
- **Root cause:** RC5 Workflow built for the normal path only
- **Roadmap phase:** 3

## RPT-03 (P2, Confirmed defect)
- **Module:** Reports
- **Business workflow:** Gross profit
- **Problem:** Sales by Customer/Salesperson do not add back returned cost; Sales by Product/Brand ignore returns.
- **Steps:** Return goods; compare with P&L.
- **Expected:** Same as P&L.
- **Actual:** 37.80 lower; returns not deducted.
- **Technical evidence:** KG test 2026-11-25
- **Source files:** src/data/supabaseAdapter.ts:4361-4600
- **Database:** invoice_items, credit_notes
- **Business impact:** Wrong commissions and margins.
- **Financial impact:** Reporting
- **Recommended solution:** One shared sales-facts query with returns.
- **Dependencies:** RPT-02
- **Regression test:** Report = P&L test
- **Root cause:** RC7 Each report has its own query over documents or ledger
- **Roadmap phase:** 4

## RPT-04 (P2, Confirmed defect)
- **Module:** Reports
- **Business workflow:** Purchases by Supplier
- **Problem:** Includes VAT and ignores purchase returns.
- **Steps:** Return goods; run report.
- **Expected:** Net, excluding VAT.
- **Actual:** 974.62 instead of 840.00.
- **Technical evidence:** KG test 2026-11-25; R-PBS returns 0
- **Source files:** src/data/supabaseAdapter.ts:4684
- **Database:** vendor_bills
- **Business impact:** Wrong totals.
- **Financial impact:** Reporting
- **Recommended solution:** Use subtotal less debit notes.
- **Dependencies:** RPT-02
- **Regression test:** Report test
- **Root cause:** RC7 Each report has its own query over documents or ledger
- **Roadmap phase:** 4

## RPT-05 (P2, Confirmed defect)
- **Module:** Reports
- **Business workflow:** AP aging
- **Problem:** Ages by ledger lines, so payments net into other buckets, negatives are hidden, and suppliers in credit are left out.
- **Steps:** Supplier with old bill and new payment.
- **Expected:** Per-document aging.
- **Actual:** Rows do not add up; supplier with a debit balance omitted.
- **Technical evidence:** KG test; R-AP
- **Source files:** src/data/supabaseAdapter.ts:3915
- **Database:** general_ledger
- **Business impact:** Wrong payment planning.
- **Financial impact:** Differs from 2100
- **Recommended solution:** Age by open document like AR.
- **Dependencies:** PAY-01
- **Regression test:** Aging = 2100 test
- **Root cause:** RC7 Each report has its own query over documents or ledger
- **Roadmap phase:** 4

## RPT-06 (P2, Confirmed defect)
- **Module:** System health
- **Business workflow:** Cheques
- **Problem:** AR/AP checks fail by uncleared cheques (Lumen 6,520 / 10,000).
- **Steps:** Post a PDC, run health.
- **Expected:** Pass.
- **Actual:** B1/B2 fail.
- **Technical evidence:** KG test
- **Source files:** -
- **Database:** verify_invariants
- **Business impact:** False alarms.
- **Financial impact:** None
- **Recommended solution:** Include 1250/2450 by party.
- **Dependencies:** RPT-05
- **Regression test:** PDC health test
- **Root cause:** RC7 Each report has its own query over documents or ledger
- **Roadmap phase:** 4

## RPT-07 (P2, Missing feature)
- **Module:** Reports
- **Business workflow:** Management
- **Problem:** No branch performance or payroll report.
- **Steps:** Look for them.
- **Expected:** Available.
- **Actual:** Not implemented.
- **Technical evidence:** Route list
- **Source files:** src/modules/reports
- **Database:** none
- **Business impact:** No branch view.
- **Financial impact:** None
- **Recommended solution:** Branch dimension in ledger.
- **Dependencies:** Branch design
- **Regression test:** -
- **Root cause:** RC6 Module not built
- **Roadmap phase:** 6

## SAL-03 (P2, Design limitation)
- **Module:** Sales
- **Business workflow:** Credit limit
- **Problem:** Credit limit only warns on screen.
- **Steps:** Limit 500, invoice 2,100.
- **Expected:** Block, or approval.
- **Actual:** Accepted.
- **Technical evidence:** D15
- **Source files:** src/modules/sales/invoice-editor.tsx:1040
- **Database:** contacts.credit_limit
- **Business impact:** Credit risk.
- **Financial impact:** Bad debts
- **Recommended solution:** Company setting: warn, approve or block.
- **Dependencies:** Approvals
- **Regression test:** Limit test
- **Root cause:** RC5 Workflow built for the normal path only
- **Roadmap phase:** 3

## SAL-04 (P2, Potential risk)
- **Module:** Sales
- **Business workflow:** Return cost
- **Problem:** A credit note line without cost restocks at zero cost.
- **Steps:** Confirm a credit note line with cost_at_sale 0.
- **Expected:** Original invoice cost used.
- **Actual:** Stock in, COGS unchanged. The screen fills the cost, so only API or unlinked notes are affected.
- **Technical evidence:** C7.13
- **Source files:** -
- **Database:** confirm_credit_note
- **Business impact:** Wrong cost on returns.
- **Financial impact:** Inventory understated
- **Recommended solution:** Take cost from invoice_item_id when empty.
- **Dependencies:** None
- **Regression test:** Zero-cost return test
- **Root cause:** RC4 Cost flow is incomplete for corrections
- **Roadmap phase:** 2

## SAL-05 (P2, Confirmed defect)
- **Module:** Sales
- **Business workflow:** Inactive product
- **Problem:** A deactivated product can still be invoiced.
- **Steps:** Deactivate, invoice, confirm.
- **Expected:** Refused for new documents.
- **Actual:** Accepted.
- **Technical evidence:** D28b
- **Source files:** -
- **Database:** confirm_invoice
- **Business impact:** Wrong items sold.
- **Financial impact:** None
- **Recommended solution:** Check is_active when confirming a new line.
- **Dependencies:** None
- **Regression test:** Inactive product test
- **Root cause:** RC3 Server trusts values that the screen computed
- **Roadmap phase:** 5

## SEC-05 (P2, Potential risk)
- **Module:** Security
- **Business workflow:** Tenant reference
- **Problem:** A company can save an invoice whose customer belongs to another company (it cannot read that customer).
- **Steps:** POST invoices with a foreign contact_id.
- **Expected:** Refused.
- **Actual:** Accepted; reading other companies was refused in all 20 tables tested.
- **Technical evidence:** S1d, S1, S1b, S1c, S1e
- **Source files:** -
- **Database:** invoices.contact_id and other foreign keys are single-column
- **Business impact:** Data quality; no leak observed.
- **Financial impact:** None observed
- **Recommended solution:** Composite foreign keys (company_id,id) or a trigger.
- **Dependencies:** Data check first
- **Regression test:** Cross-tenant FK test
- **Root cause:** RC2 Tables stay open for direct writes after posting
- **Roadmap phase:** 5

## SO-01 (P2, Missing feature)
- **Module:** Sales
- **Business workflow:** Sales order and delivery
- **Problem:** sales_orders tables exist, but no screen; no delivery note, partial delivery or reservation.
- **Steps:** Look for screens.
- **Expected:** Quote to order to delivery to invoice.
- **Actual:** Quote to invoice only.
- **Technical evidence:** Route list
- **Source files:** src/modules/sales
- **Database:** sales_orders, sales_order_items
- **Business impact:** Distribution flow incomplete.
- **Financial impact:** None
- **Recommended solution:** Sales order + delivery module.
- **Dependencies:** Doc 3
- **Regression test:** -
- **Root cause:** RC6 Module not built
- **Roadmap phase:** 6

## DOC-01 (P3, Confirmed defect)
- **Module:** Print
- **Business workflow:** SKU
- **Problem:** SKU column is empty on the print page, but shows in the invoice view.
- **Steps:** Print INV-1012.
- **Expected:** SKU shown.
- **Actual:** Blank.
- **Technical evidence:** KG test
- **Source files:** src/modules/print/PrintPage.tsx
- **Database:** products
- **Business impact:** Cosmetic.
- **Financial impact:** None
- **Recommended solution:** Pass products to the print adapter.
- **Dependencies:** None
- **Regression test:** Print test
- **Root cause:** RC5 Workflow built for the normal path only
- **Roadmap phase:** 5

## DOC-02 (P3, Confirmed defect)
- **Module:** Tests / docs
- **Business workflow:** Upkeep
- **Problem:** One unit test fails (INR symbol) and CURRENT_PHASE.md still says Phase 12, May 2026.
- **Steps:** Run unit tests.
- **Expected:** All pass; current.
- **Actual:** 791 of 792.
- **Technical evidence:** Unit run 2026-11-25
- **Source files:** tests/unit/locale.test.ts, docs/CURRENT_PHASE.md
- **Database:** -
- **Business impact:** Noise.
- **Financial impact:** None
- **Recommended solution:** Fix both.
- **Dependencies:** None
- **Regression test:** -
- **Root cause:** RC5 Workflow built for the normal path only
- **Roadmap phase:** 5

## INV-02 (P3, Design limitation)
- **Module:** Inventory
- **Business workflow:** Cost rounding
- **Problem:** Average cost is kept to 2 decimals: 3 units for 10.00 value at 9.99.
- **Steps:** Buy 3 for 10.00.
- **Expected:** 10.00.
- **Actual:** GL 10.00, valuation 9.99. Simulation drift 0.51; within tolerance 1.
- **Technical evidence:** E4, E2
- **Source files:** -
- **Database:** stock_ledger.running_avg_cost numeric(15,2)
- **Business impact:** Small drift on cheap items.
- **Financial impact:** Cents
- **Recommended solution:** Keep 6 decimals internally.
- **Dependencies:** Large test
- **Regression test:** Rounding test
- **Root cause:** RC4 Cost flow is incomplete for corrections
- **Roadmap phase:** 5

## SEC-06 (P3, Potential risk)
- **Module:** Security
- **Business workflow:** Table grants
- **Problem:** anon and authenticated hold TRUNCATE/TRIGGER grants on many tables (not reachable through REST).
- **Steps:** Inspect role_table_grants.
- **Expected:** Only needed grants.
- **Actual:** Grants present.
- **Technical evidence:** Static query
- **Source files:** -
- **Database:** invoices, payments, audit_logs grants
- **Business impact:** Low
- **Financial impact:** None
- **Recommended solution:** Revoke unused grants.
- **Dependencies:** None
- **Regression test:** Grant snapshot test
- **Root cause:** RC2 Tables stay open for direct writes after posting
- **Roadmap phase:** 5

