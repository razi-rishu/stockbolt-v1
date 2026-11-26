# 07 Accounting and financial audit

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

| Check | Result | Figures |
|---|---|---|
| Debits equal credits | Pass | 110 entries, 255 lines, 0 unbalanced |
| Every journal has lines | Pass | 110 headers |
| Unbalanced, 0.01 and negative journals refused | Pass | D22, D22b, D23d |
| Stock ledger = 1300 | Fail | 2,500.39 against 2,547.39 (PUR-01 40.00, ACC-01 7.00) |
| AR aging = 1200 | Fail | Difference 251.00 |
| AP aging = 2100 | Fail | Difference 504.00 |
| Control accounts name a party | Fail | 1 line (ACC-01) |
| Balance sheet | Pass | Balanced |
| Payroll: gross 20,000 less 100; gratuity 875 | Pass | 6100 20,775; 2350 cleared; 2360 875 |
| Depreciation 1,200 over 12 | Pass | 100 for October; rerun adds nothing |
| Disposal at 900 | Pass | Cost and depreciation cleared, loss 200 |
| Amortization | Pass | 100 for October |
| Customer advance | Pass | 2400 moved from -1,500 to -1,395 |
| Foreign currency | Fail | 100 posted, 367 expected |
| Cash flow closing cash | Pass | Equals ledger cash and bank |

The failing reconciliations came from deliberate exception tests, not from normal entry. In the normal KG/litre/box test the same day, stock, AR and AP agreed except for cheques (RPT-06).

Loss 200 on disposal: book value after October is 1,100; proceeds 900.

| ID | Severity | Type | Problem | Evidence |
|---|---|---|---|---|
| PAY-01 | P1 | Confirmed defect | The server lets a payment be applied for more than is due, more than once. | D6, D10, D11 |
| PAY-02 | P1 | Confirmed defect | Voiding an invoice that has a confirmed receipt leaves the receipt fully allocated to the void invoice. | D20c, D20b, E3 (B1) |
| ACC-01 | P1 | Confirmed defect | Manual journals can post to 1200/2100 without a party, to 1300, and can be labelled sales_invoice. | D23, D23b, D23c, E3 (B3) |
| ACC-02 | P1 | Confirmed defect | Opening stock and opening balances post into a locked period. | D29 |
| ACC-03 | P1 | Confirmed defect | Taxable amounts are all of account 4100 and cost of goods sold 5100. VAT amounts are right. | R-VAT, KG test 2026-11-25 |
| ACC-04 | P1 | Confirmed defect | A return can be filed with figures that do not match the books. | C12.3-quarterly, C12.3-monthly |
| ACC-05 | P2 | Design limitation | Foreign amounts post unconverted if a document carries another currency. The screen locks base currency. | D27 |
| ACC-06 | P2 | Potential risk | Asset buying and sale proceeds in the period appeared under operating, investing was empty (total cash agrees). | R-CF |
| BNK-01 | P2 | Design limitation | A bank or cash account can go far below zero. | D24 |
| BNK-02 | P2 | Confirmed defect | A reconciliation that does not agree can be locked. | C10.5 |
| BNK-03 | P2 | Missing feature | No bank statement import or auto-matching. | Code review |
| HR-01 | P1 | Confirmed defect | Gratuity can be settled above what is accrued. | C9.8b |
| HR-02 | P2 | Missing feature | The loans table exists, but there is no screen and no posting to 1450. | C8.14 |
| HR-03 | P2 | Missing feature | No attendance, leave requests, leave policy or payroll approval; leave salary payout only. | Route list |
| RPT-01 | P1 | Confirmed defect | Supplier and customer statements ignore the opening balance. | R-SST, R-CST |
| RPT-02 | P1 | Confirmed defect | Opening balances count as sales and purchases. | R-SBC, R-PBS |
| RPT-03 | P2 | Confirmed defect | Sales by Customer/Salesperson do not add back returned cost; Sales by Product/Brand ignore returns. | KG test 2026-11-25 |
| RPT-04 | P2 | Confirmed defect | Includes VAT and ignores purchase returns. | KG test 2026-11-25; R-PBS returns 0 |
| RPT-05 | P2 | Confirmed defect | Ages by ledger lines, so payments net into other buckets, negatives are hidden, and suppliers in credit are left out. | KG test; R-AP |
| RPT-06 | P2 | Confirmed defect | AR/AP checks fail by uncleared cheques (Lumen 6,520 / 10,000). | KG test |
| RPT-07 | P2 | Missing feature | No branch performance or payroll report. | Route list |
