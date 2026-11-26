# 14 Regression test plan

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

1. Turn this simulation into a permanent local-staging suite (tests/integration, local allow-list only).
2. Run before each phase (baseline) and after it.
3. Checks that pass today must still pass: C1.1, C1.1b, C1.2, C1.3, C1.4, C1.5-accountant, C1.5-sales, C1.5-counter, C1.5-viewer, C1.6, C1.7-wh, C1.7-pu, C3, C7.1, C4.1, C4.2, C4.3, C3.2, C3.3-ar_owed, C3.3-ap_owed, C3.3-customer_credit, C3.3-vendor_credit, C5.4, C5.6, C5.7, C5.7b, D5, C5.8, C5.10, D7, D7b, C6.2, D8, C6.7, C6.9, C7.3, C7.9, C7.10, C7.11, D12, D13, D14, D16, D18, D19, D20, D21, C7.13r, C7.15r, C8.8, D22, D22b, D23d, C8.7, C10.2, C8.9, D25, C8.11, C8.12, C2, C9.3, D26, C9.8, C8.pdc, D28, D28c, D28d, D28e, D28f, S1, S1b, S1c, S1e, S2, S2b, S3, S3b, S6-sales, S6-counter, S4-viewer, S5-viewer, S6-viewer, S7-viewer, S8-viewer, S6-wh, S6-pu, S7-pu, S8-pu, S5-acc, S9, S9b, S10-sales, S10-viewer, S10-counter, S12g, S13b, S14, C12.1, D29b, C12.2, E1, E1b, S15r, C7.1d, E4, D31, S16.
4. For every function changed: compare ledger lines of a sample of existing documents before and after; they must be identical.
5. Web, phone layout, Arabic, and an Android build per release.

| Issue | Test to add | Must turn green |
|---|---|---|
| SEC-01 | One test per function per role | S5-sales/counter/wh/pu, S8-sales/counter/wh, S10-wh/pu, S11, S11b, S11c |
| SEC-02 | Table-by-table REST tests | S12, S12b, S12c, S12d, S12e, S12f, S12h, D29c |
| SEC-03 | Role x table read matrix | S4-*, S7-* |
| SEC-04 | Forge test | S13 |
| SEC-05 | Cross-tenant FK test | S1d, S1, S1b, S1c, S1e |
| SEC-06 | Grant snapshot test | Static query |
| PAY-01 | Concurrent and over-allocation tests | D6, D10, D11 |
| PAY-02 | Void-with-receipt test | D20c, D20b, E3 (B1) |
| PUR-01 | Price-variance test | D2, E2, E3 (E1) |
| PUR-02 | Double-bill test | D3 |
| PUR-03 | Partial receipt test | C5.5 |
| PUR-04 | Over-receipt test | D1 |
| PUR-05 | Duplicate test | D4 |
| SAL-01 | Damaged return test | D17r |
| SAL-02 | Mismatch test | D31b, D31 |
| SAL-03 | Limit test | D15 |
| SAL-04 | Zero-cost return test | C7.13 |
| SAL-05 | Inactive product test | D28b |
| POS-01 | Walk-in test | C7.1c |
| POS-02 | No-cost POS test | Memory: costing findings 2026-11-24 |
| INV-01 | Stale count test | D9 |
| INV-02 | Rounding test | E4, E2 |
| INV-04 | Void tests | V-* |
| PUR-06 | Void bill test | V-void_vendor_bill |
| ACC-01 | JE control tests | D23, D23b, D23c, E3 (B3) |
| ACC-02 | Lock matrix | D29 |
| ACC-03 | Mixed-rate VAT test | R-VAT, KG test 2026-11-25 |
| ACC-04 | Filing test | C12.3-quarterly, C12.3-monthly |
| ACC-05 | Refusal test | D27 |
| ACC-06 | Cash flow test | R-CF |
| BNK-01 | Cash test | D24 |
| BNK-02 | Recon test | C10.5 |
| HR-01 | Cap test | C9.8b |
| HR-02 | Loan test | C8.14 |
| RPT-01 | Opening test | R-SST, R-CST |
| RPT-02 | Opening filter test | R-SBC, R-PBS |
| RPT-03 | Report = P&L test | KG test 2026-11-25 |
| RPT-04 | Report test | KG test 2026-11-25; R-PBS returns 0 |
| RPT-05 | Aging = 2100 test | KG test; R-AP |
| RPT-06 | PDC health test | KG test |
| GEN-01 | Conflict test | D30 |
| DOC-01 | Print test | KG test |
