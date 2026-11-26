# 03 Business process map

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

Solid steps exist. Steps in [brackets] do not.

```
Buying : [Request] > [RFQ/compare] > Purchase order > Goods receipt (Dr 1300 Cr 2150) > Bill (Dr 2150 Cr 2100) > Payment > Debit note
Direct : Bill (Dr 1300 Cr 2100) > Payment
Selling: Quote > [Order] > [Reserve] > [Delivery] > Invoice (Dr 1200 Cr 4100/2200; Dr 5100 Cr 1300) > Receipt > Credit note > Refund
Counter: POS session > Sale (invoice + receipt) > Close session
Stock  : Opening > Transfer / Adjustment / Repack > Valuation
Cash   : Bank account > Transfer / Expense / Cheque > Reconciliation > [Statement import]
Payroll: Employee > [Attendance/Leave] > Run (Dr 6100 Cr 2350/2360) > Pay > Gratuity
Close  : Depreciation / Amortization > VAT return > Period lock > Year-end close
```

| Workflow | Status | Evidence |
|---|---|---|
| Business registration | Passed | C1.1 |
| Branches and warehouses | Passed | C1.2, C1.3 |
| Users, invites, custom roles | Passed | C1.5-C1.7 |
| Setup wizard module activation | Not tested | Global wizard screens not driven; core onboarding only |
| Tax, numbering, payment method setup | Partial | Seeded defaults read; editing not driven |
| Opening stock and bank openings | Passed | C4.3, C3.2 |
| Opening AR/AP/credits | Passed | C3.3-ar_owed and others; but see ACC-02, RPT-02 |
| Categories, products, units | Passed | C4.1, C4.2 |
| Suppliers, customers | Passed | C3, C7.1 |
| Employees | Passed | C2 |
| Departments and designations | Partial | Text fields only |
| Attendance, leave policy | Not implemented | HR-03 |
| Purchase request, quotation, comparison | Not implemented | PR-01 |
| Purchase order | Passed | C5.4 |
| Partial goods receipt | Failed | C5.5 (PUR-03) |
| Full goods receipt | Passed | C5.6 |
| Over-receipt control | Failed | D1 |
| GRN to bill, same price | Passed | C5.7 |
| GRN to bill, different price | Failed | D2 |
| GRN billed once only | Failed | D3 |
| Direct bill | Passed | C5.7b, E4 |
| Supplier payment | Passed | C5.8 |
| Over-allocation control | Failed | D6, D10, D11 |
| Purchase return | Passed | C5.10, D7, D7b |
| Bill cancellation | Partial | Reopen and delete only (PUR-06) |
| Stock transfer across branches | Passed | C6.2, D8 |
| Damage and found adjustments | Passed | C6.7, C6.9 |
| Stock count while trading | Failed | D9 |
| Reservation | Not implemented | INV-03 |
| Repack and packs | Passed | KG/box test 2026-11-25 |
| Negative stock guard | Passed | D14 |
| Simultaneous sale of last stock | Passed | D13 |
| Quotation | Passed | C7.3 |
| Quotation approval | Not tested | Approval rules not exercised |
| Sales order, delivery | Not implemented | SO-01 |
| Sales invoice with cost | Passed | C7.9, D12 |
| Invoice total control | Failed | D31b |
| Part and full receipt | Passed | C7.10, C7.11 |
| Credit limit | Partial | Warning only (D15) |
| Customer return, resellable | Passed | C7.13r, D18 |
| Customer return, damaged | Failed | D17r |
| Customer refund | Passed | C7.15r |
| Customer advance | Passed | D21 |
| Receipt reversal | Passed | D19 |
| Invoice cancellation, unpaid | Passed | D20 |
| Invoice cancellation, paid | Failed | D20c |
| POS sale with customer | Passed | C7.1d |
| POS walk-in sale | Failed | C7.1c |
| Journal voucher | Passed | C8.8, D22, D22b, D23d |
| Journal control accounts | Failed | D23, D23b, D23c |
| Expense with VAT | Passed | C8.7 |
| Fixed asset, depreciation, disposal | Passed | C8.9, D25, C8.11 |
| Asset purchase by bill | Not tested | Covered by earlier phase126 test only |
| Prepaid amortization | Passed | C8.12 |
| Employee advances | Not implemented | HR-02 |
| Payroll run and payment | Passed | C9.3, D26 |
| Payroll approval | Not tested | - |
| Gratuity within accrual | Passed | C9.8 |
| Gratuity cap | Failed | C9.8b |
| Post-dated cheque | Passed | C8.pdc |
| Bank transfer | Passed | C10.2 |
| Cash overdraft control | Failed | D24 |
| Bank reconciliation control | Failed | C10.5 |
| Statement import and matching | Not implemented | BNK-03 |
| Trial balance / balance sheet | Passed | E1; R-BS; on-screen TB |
| Stock value = ledger | Failed | E2 (PUR-01, ACC-01) |
| AR / AP = aging | Failed | E3 |
| Statements | Failed | RPT-01 |
| Sales and purchase reports | Failed | RPT-02 to RPT-04 |
| VAT return figures | Failed | ACC-03 |
| VAT filing control | Failed | C12.3 |
| Cash flow | Partial | Total agrees; classification ACC-06 |
| Branch and payroll reports | Not implemented | RPT-07 |
| Period lock, normal documents | Passed | D29 (JE, invoice, expense, depreciation) |
| Period lock, openings | Failed | D29 |
| Period unlock right | Passed | D29b |
| Year-end close run | Not tested | Year 2026 not ended; early close refused (C12.2) |
| Foreign currency | Failed | D27 |
| Exchange rate change | Not tested | Blocked by ACC-05 |
| Company isolation | Passed | S1, S1b, S1c, S1e, S2, S2b |
| Cross-company reference | Failed | S1d |
| Privilege escalation | Passed | S3, S3b, S14 |
| Role posting rights | Failed | S5, S8, S10, S11 |
| Role read rights | Failed | S4, S7 |
| Payroll privacy | Passed | S6, S9 |
| Posted document protection | Failed | S12 group |
| Ledger protection | Passed | S12g |
| Audit log integrity | Partial | Forge possible (S13), delete refused (S13b) |
| Branch restriction | Passed | S15r |
| Delete master data with history | Passed | D28c-D28f |
| Deactivated product | Failed | D28b |
| Simultaneous editing | Failed | D30 |
