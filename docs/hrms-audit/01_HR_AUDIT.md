# HRMS audit — sections A to H

> Audit date 2026-11-27. Method: code and schema reading on `main` (f409628 + the H0 card fix), local staging (Docker, 127.0.0.1) for every test. No production data read or changed. The 100-employee simulation is **not run yet**; it is the first step of phase H1 (document 03). Statements below marked *verified* were exercised on staging; the rest come from reading the code and schema.

## A. Existing HR module inventory

Navigation: **Payroll** (needs `payroll.read`) → Payroll Runs, Employees, Leave Salary. Team (Settings) holds the org chart.

| Area | What exists | Where | State |
|---|---|---|---|
| Employee master | One record per person (phase129); code, names, designation, department, phone, email, IDs, bank, salary structure (basic + 3 allowances), active, in-payroll, reports-to, login link. phase163 adds photo, branch, home warehouse, employment type, nationality, date of birth, emergency contact, document numbers and expiries, pay method, scanned files | `employees`, `employee_documents`, `src/modules/payroll/employee-360/` | Working (*verified*) |
| Employee profile | Read-only profile, Edit mode, connections, document expiry, payroll history, leave salary history | Employee 360 | Working after H0 (*verified*) |
| Work roles | Salesperson (commission), purchaser; quick-create from sales and purchase documents | `assign_staff_role`, `create_staff`, `salespeople` | Working |
| Org chart | Reports-to tree, single top, login link, code format | Team page, `set_employee_manager`, `link_employee_user` | Working |
| Payroll runs | Monthly run per company; lines copied from the salary structure, then editable: overtime, bonus, deductions, loan repayment; confirm, pay, void; approvals (phase147); period lock | `payroll_runs`, `payroll_run_items`, `confirm_/pay_/void_payroll_run` | Working |
| Payroll posting | Confirm: Dr 6100 (gross − deductions) / Cr 2350 net, Cr 1450 loan recovery; gratuity accrual Dr 6100 / Cr 2360. Pay: Dr 2350 / Cr bank | `confirm_payroll_run`, `pay_payroll_run` | Working (phase125) |
| WPS | SIF file export (UAE) | `wps-sif.ts` | Working, UAE only |
| Gratuity | Estimate on screen; final settlement posts Dr 2360 / Cr bank and deactivates | `gratuity.ts`, `settle_gratuity` | Working, **one formula for all countries** |
| Leave | **Leave salary payout only**: earned days = 30 × years since joining, minus days already paid; pays Dr 6100 / Cr bank | `leave-salary.tsx`, `pay_leave_salary` | Working, **no leave management** |
| Loans | Table exists (`amount`, `monthly_installment`, `balance`, `status`) | `employee_loans` | **No screen**; stored balance |
| Attendance, shifts, holidays | — | — | Not built |
| Self-service | — | — | Not built |
| Recruitment, onboarding, performance, training | — | — | Not built |
| HR dashboard and reports | Payroll and leave lists only | — | Not built |

## B. Employee management

| Requirement | State |
|---|---|
| Employee ID, full name, Arabic name, photo, date of birth, nationality, phone, email, emergency contact, ID details | Present (photo upload untested end to end: no Storage on staging) |
| Gender, marital status, residential address | **Missing** |
| Joining date, status, employment type, department, designation, branch, work location (home warehouse), reporting manager | Present. Employment types are full time / part time / contract / intern; the brief's **permanent / probation / temporary** are not modelled |
| Probation period, confirmation date, contract dates, working schedule | **Missing** |
| Documents with categories and expiry | Present for ID, passport, visa, labour card, contract, other; **no certificates or qualifications category**, no document history, no reminders other than the list flag |
| Card opens profile, explicit Edit | **Fixed in H0** (HR-01) |
| Deactivate from profile | Added in H0; past payroll keeps the person |
| History (salary, department, branch, status changes) | **Missing**: edits overwrite the row; only Team actions write audit rows |
| Lifecycle (recruit → archive) | Only create, edit, deactivate, final settlement, delete-if-no-history |

## C. Payroll

| Requirement | State |
|---|---|
| Components | Fixed set: basic, housing, transport, other, overtime, bonus, deductions, loan repayment. **No custom components**, no food or communication allowance, no commission feed |
| Pay cycle | Monthly only |
| Effective-dated salary and revisions | **Missing**: the run copies today's salary; mid-month changes are typed by hand |
| Proration for joiners and leavers | **Missing**: full month unless edited |
| Unpaid leave | Manual "deductions" figure; not linked to leave |
| Overtime | Manual figure; no rate or attendance link |
| Loans and advances | Manual "loan repayment" figure; loan balance column is not reconciled to it (to verify) |
| Approval | Yes (phase147 approvals); confirm and pay are separate steps |
| Double approve / double pay | Prevented by status checks and the payroll lock trigger (phase131) |
| Change after confirm | Blocked; void reverses at the voucher date |
| Payslip | **Missing entirely** |
| Branch payroll cost | **Not possible**: one journal per run with no branch |
| Payroll reconciliation | Run totals equal the journal (single posting function) |

## D. Leave management

There is no leave management. The "Leave Salary" page pays out a computed balance:

- earned days = 30 × years since joining, for every country and from day one (UAE law gives 2 days a month after 6 months in the first year; India and others differ);
- balance = earned − days already paid; leave actually *taken* is never recorded;
- daily wage = full wage ÷ 30 (GCC) or basic ÷ 26 (India).

Missing: leave types, policies, accrual, carry-forward, expiry, requests, approvals, calendar, holidays and weekends, half days, attachments, balances, reports, and the link to payroll and final settlement.

## E. Attendance and schedules

Nothing exists. A full time-clock is not needed to run payroll correctly; what payroll needs is **approved absence and approved overtime**. Recommendation: a light module (work schedules, weekly offs, holiday calendar, daily attendance by manual entry or file import, corrections with approval, overtime approval) that feeds payroll only through approved, locked figures. Device integration later through the same import.

## F. Multi-branch HR

| Requirement | State |
|---|---|
| Employee branch | Added in phase163 |
| Branch / department directory and filters | **Missing** (one list, active toggle only) |
| Bulk import, export, status change | **Missing** |
| Branch-scoped HR access (branch manager sees own branch) | **Missing**: payroll.read sees everyone |
| Branch payroll reporting | **Missing** (see C) |
| Transfers with history | **Missing** (field overwrite only) |

## G. HR security and permissions

| Check | Result |
|---|---|
| Company isolation | RLS `tenant_isolation` on all HR tables; phase163 tests E11–E16 *verified* other company and anon refused |
| Salary visibility | Everything is behind `payroll.read` (admin-only since phase130). There is **no HR role without salary** and **no employee access to their own data** |
| Documents | Private bucket, signed links, payroll rights (phase163) |
| Payroll approval | Approvals engine; confirm and pay need `payroll.write` (phase158) |
| Leave approval | Not applicable yet |
| Deletion | Only an employee with no payroll, loan, leave or document history (trigger) |
| Audit | Team actions and posting functions write audit rows; **employee field edits and salary changes are not audited** |
| Branch scoping | None for HR |

## H. Missing functionality (summary)

1. Leave engine (types, policies, requests, approvals, balances, calendar, holidays, reports, payroll link).
2. Payslips.
3. Effective-dated salary structures with revisions and history; proration.
4. Configurable salary components.
5. Employment history (transfers, promotions, status changes) and field audit.
6. HR roles: HR officer without salary, payroll accountant, branch manager scoped to a branch, employee self-service.
7. Self-service portal (own profile, leave, payslips, documents).
8. Attendance light: schedules, holidays, daily attendance, overtime approval.
9. Exit workflow: resignation, notice, checklist, combined final settlement (salary to date, leave encashment, gratuity per country policy, loan recovery), login deactivation.
10. Loans screen with ledger-derived balance.
11. Directory filters, pagination, bulk import and export.
12. HR dashboard and reports.
13. Country policy packs (UAE, India, other GCC) as editable templates, not hard-coded rules.
14. Recruitment, performance, training: **not needed now** (see document 03).
