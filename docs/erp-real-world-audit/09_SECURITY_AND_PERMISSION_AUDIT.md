# 09 Security and permission audit

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

## What each role could do
| Action | Sales | Counter | Warehouse | Purchase | Viewer |
|---|---|---|---|---|---|
| Read general ledger | Yes | Yes | Yes | Yes | Yes |
| Post a manual journal | Yes | Yes | Yes | Yes | No |
| Read salaries | No | No | No | No | No |
| Confirm an expense | Yes | Yes | Yes | Yes | No |
| Void a customer receipt | Yes | Yes | Yes | Yes | No |

Viewer reading the ledger is intended. Warehouse and Purchase are custom roles. Owner worked as admin; Accountant could post a journal and could not unlock the period. HR, branch and sales manager were not tested.

## Passed
Company isolation (20 tables, inserts, functions with a company parameter), anonymous access, self-promotion, moving company, changing settings, editing ledgers, deleting audit rows, payroll privacy, branch restriction, deleting records with history.

## Findings
| ID | Severity | Type | Problem | Evidence |
|---|---|---|---|---|
| SEC-01 | P0 | Confirmed defect | Most posting functions check only that the caller belongs to the company, not that the caller holds the right. Any user with any write right can post. | S5-sales/counter/wh/pu, S8-sales/counter/wh, S10-wh/pu, S11, S11b, S11c |
| SEC-02 | P0 | Confirmed defect | Confirmed documents can be changed or deleted directly through the table API, and drafts can be marked confirmed without posting. | S12, S12b, S12c, S12d, S12e, S12f, S12h, D29c |
| SEC-03 | P1 | Confirmed defect | Sales, Counter and Warehouse users can read the general ledger, supplier bills, expenses, bank accounts and payments through the API. | S4-*, S7-* |
| SEC-04 | P1 | Confirmed defect | Any signed-in user can insert audit rows, with user_id empty. | S13 |
| SEC-05 | P2 | Potential risk | A company can save an invoice whose customer belongs to another company (it cannot read that customer). | S1d, S1, S1b, S1c, S1e |
| SEC-06 | P3 | Potential risk | anon and authenticated hold TRUNCATE/TRIGGER grants on many tables (not reachable through REST). | Static query |

These need a signed-in user of the same company; no cross-company data was read. Dependency scanning, penetration testing, rate limits and storage buckets were not tested.
