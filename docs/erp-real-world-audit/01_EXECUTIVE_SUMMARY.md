# 01 Executive summary

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

## A. Overall readiness
**Not ready for use by a company with several staff roles until phases 1 and 2 of the roadmap are done.** Reason (method in document 15): two P0 findings let ordinary staff change posted financial records, and P1 findings break the AR, AP and stock reconciliation checks. Balanced journals, stock control, moving-average cost, company isolation and payroll privacy worked in every test.

No percentage score is given: the workflows are not equally important, and several are untested.

## B-G. Counts
| Measure | Count |
|---|---|
| Modules reviewed | 44 |
| Business workflows listed | 92 |
| Passed | 45 |
| Failed | 28 |
| Partial | 6 |
| Not implemented | 7 |
| Not tested | 6 |
| Individual test checks run | 170 |
| Checks passed | 107 |
| Checks failed | 63 |
| Checks ended in error | 0 |

A failed check means the system did not behave as a safe ERP should in that case; one workflow can have several checks.

## H. Findings
| P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|
| 2 | 16 | 27 | 4 | 49 |

| Type | Count |
|---|---|
| Confirmed defect | 30 |
| Missing feature | 8 |
| Design limitation | 7 |
| Potential risk | 4 |

## I. Critical accounting discrepancies
Simulation company, all from deliberate exception tests: account 1300 was 2,547.39 and stock ledger 2,500.39 (47.00: 40.00 PUR-01, 7.00 ACC-01). AR aging differed from 1200 by 251.00 and AP aging from 2100 by 504.00 after the over-allocation, void and journal tests. Every one of the 110 journal entries balanced.

## J. Inventory discrepancies
PUR-01 price difference, SAL-01 damaged return, INV-01 count, INV-02 rounding. Transfers, sales, returns and repack conserved quantity.

## K. Security
| ID | Severity | Type | Problem | Evidence |
|---|---|---|---|---|
| SEC-01 | P0 | Confirmed defect | Most posting functions check only that the caller belongs to the company, not that the caller holds the right. Any user with any write right can post. | S5-sales/counter/wh/pu, S8-sales/counter/wh, S10-wh/pu, S11, S11b, S11c |
| SEC-02 | P0 | Confirmed defect | Confirmed documents can be changed or deleted directly through the table API, and drafts can be marked confirmed without posting. | S12, S12b, S12c, S12d, S12e, S12f, S12h, D29c |
| SEC-03 | P1 | Confirmed defect | Sales, Counter and Warehouse users can read the general ledger, supplier bills, expenses, bank accounts and payments through the API. | S4-*, S7-* |
| SEC-04 | P1 | Confirmed defect | Any signed-in user can insert audit rows, with user_id empty. | S13 |
| SEC-05 | P2 | Potential risk | A company can save an invoice whose customer belongs to another company (it cannot read that customer). | S1d, S1, S1b, S1c, S1e |
| SEC-06 | P3 | Potential risk | anon and authenticated hold TRUNCATE/TRIGGER grants on many tables (not reachable through REST). | Static query |

## L. Missing features
| ID | Severity | Type | Problem | Evidence |
|---|---|---|---|---|
| INV-03 | P2 | Missing feature | No stock reservation and no available-versus-on-hand. | Schema review |
| INV-04 | P2 | Missing feature | No void for transfers, adjustments or goods receipts. | V-* |
| BNK-03 | P2 | Missing feature | No bank statement import or auto-matching. | Code review |
| HR-02 | P2 | Missing feature | The loans table exists, but there is no screen and no posting to 1450. | C8.14 |
| HR-03 | P2 | Missing feature | No attendance, leave requests, leave policy or payroll approval; leave salary payout only. | Route list |
| RPT-07 | P2 | Missing feature | No branch performance or payroll report. | Route list |
| SO-01 | P2 | Missing feature | sales_orders tables exist, but no screen; no delivery note, partial delivery or reservation. | Route list |
| PR-01 | P2 | Missing feature | No purchase request, supplier quotation or comparison. | Route list |

## M. Web and Android
See document 10. No real Android device was used.

## N-O. Roadmap
See document 13. Six phases; complexity and dependencies are given per phase. **Nothing has been fixed. Waiting for approval.**
