# HRMS roadmap, architecture and acceptance (sections I, K, L, M)

> 2026-11-27. Every phase: built and tested on local staging first, additive migrations, no change to existing payroll postings unless Document 3 is updated first, production only with Rashid's approval, web and Android together.

## I. Recommended HR navigation

One top-level **HR** group replaces "Payroll" (same permission gate until H1 adds HR rights):

| Item | Contents | Phase |
|---|---|---|
| HR Dashboard | Headcount, joiners/leavers, on leave today, pending approvals, expiring documents, probation ending, payroll cost by branch | H7 |
| Employees | Directory (branch / department / status / type filters, search, paging, import, export) → Employee 360 profile | H0 done, H1 |
| Leave | Requests, approvals inbox, calendar, balances, leave types and policies (settings) | H2 |
| Attendance | Daily attendance, corrections, overtime approval, schedules, holidays | H5 |
| Payroll | Runs, payslips, salary components, loans | H3 |
| Exits | Resignations, notice, checklist, final settlement | H6 |
| Reports | Leave, payroll, headcount, document expiry, branch cost | H7 |
| My HR (self-service) | Own profile, leave, attendance, payslips, documents | H4 |

Leave Salary stays reachable until H2 replaces its calculation.

## K. Remediation roadmap

| Phase | Name | Closes | Needs before starting |
|---|---|---|---|
| **H0** | Card opens profile, explicit Edit, deactivate | HR-01 | — (**done**, uncommitted) |
| **H1** | HR foundations | HR-06 (history part), HR-07 (rights), HR-08, HR-13, HR-14, HR-18 | Decisions D3, D4 |
| **H2** | Leave engine | HR-02, HR-05 (leave part), HR-11, HR-19 (leave) | D1, D2 |
| **H3** | Payroll upgrade | HR-03 (payroll accrual), HR-04, HR-05, HR-06, HR-09, HR-10 | D2, D5 |
| **H4** | Employee self-service | HR-07 (self-service) | D3 |
| **H5** | Attendance light | HR-12, HR-05 (overtime) | H1 |
| **H6** | Exit workflow | HR-03 (settlement), HR-15 | H2, H3, D1 |
| **H7** | HR dashboard and reports | HR-17 | H1–H3 |
| Later, only if asked | Recruitment, performance, training | — | A real customer need |

### H1 — HR foundations
- Employee fields: gender, marital status, address, probation end, confirmation date, contract start/end, work schedule (link in H5). Employment types: permanent, probation, contract, part time, temporary, intern (existing values kept).
- **Employment history** (`employee_events`, append-only): join, confirm, transfer (branch / department), promotion (designation), manager change, status change, salary revision, exit. Written by triggers from the employee row, so every path is covered. Shown as a timeline on the profile.
- **Field audit**: bank details, salary and status changes write `audit_logs`.
- **HR rights** (new, additive): `hr.read` (profile without salary), `hr.write`, `hr.salary.read`, `leave.approve`, `payroll.approve`; branch scoping through the existing branch access (Global Phase 6). Existing `payroll.read/write` keep working.
- Directory: filters, search, server paging, CSV import (preview + validation, no partial import) and export.
- **Staging seed**: script that creates the 100-employee, 4-location test company through the app's own functions (used by every later phase).

### H2 — Leave engine (Rule 1: balances derived, never stored)
- `leave_types` (company-defined: annual, sick, unpaid, maternity, … with paid / partly paid / unpaid, needs document, half day allowed, hourly allowed).
- `leave_policies` (type + scope: country, branch, employment type, department; entitlement, accrual method monthly/annual/front-loaded, probation eligibility, minimum service, carry-forward days and expiry, maximum balance, negative allowed, leave year start, weekends and holidays counted or not, pay bands e.g. sick full/half/unpaid days).
- `holiday_calendars` per country/branch; weekly off pattern per schedule.
- `leave_requests` (dates, half day, hours, reason, attachments in the private bucket, status) with approval steps by chain: manager → branch manager → HR, configurable per company; return for correction, cancel, withdraw, delegate, escalate.
- `leave_ledger` (append-only: opening, accrual, adjustment, taken, reversal, carry-forward, expiry, encashment). **Balance = sum of ledger rows** at a date; nothing cached.
- Calendar (company / branch / department), overlap warnings, reports (statement, balances, liability, carry-forward, expired).
- Leave salary page reads the ledger instead of 30 days × years.
- Country templates (see section L, compliance) are offered as editable starting points, **marked "verify before use"**, never applied silently.

### H3 — Payroll upgrade
- `salary_components` (earning / deduction, fixed / % of basic / per day / per hour, taxable flag kept for future) and `employee_salary` (effective-dated rows). Revision = new row; history kept.
- Run builder: proration for joiners and leavers, unpaid leave days from H2 (approved only), overtime from H5 (approved only), loan instalments from the loan schedule; every figure on a line shows where it came from; manual adjustments kept as separate, labelled lines.
- **Payslips**: PDF per employee per run (company, employee, period, earnings, deductions, gross, net, payment date, status), English and Arabic; employee can open only their own (RLS on the run line by `employees.user_id`).
- Loans screen; balance derived from disbursement journal and recoveries (HR-09).
- Branch dimension on payroll journal lines (HR-10) **only after Document 3 records it** (D5).

### H4 — Self-service
Own profile (edit only allowed fields, e.g. phone and emergency contact), leave apply/track/cancel, balances, own attendance and corrections, own payslips, own documents, HR requests. Requires each employee to have a login (D3).

### H5 — Attendance light
Schedules (hours, weekly offs, shift patterns), daily attendance by manual entry or CSV import, late/early/absent flags, corrections with approval, overtime approval at configured rates, monthly lock that payroll reads. Device integration later via the same import.

### H6 — Exit workflow
Resignation or termination request → notice period → approvals → last working day → checklist (handover, assets, access) → settlement sheet: salary to last day (H3 proration), leave encashment from the H2 ledger, gratuity from the **country policy**, loan and advance recovery → approval → payment posting (existing engines) → login deactivated → record archived (never deleted; history stays in reports).

### H7 — Dashboard and reports
All from database records: headcount by branch/department/type, joiners, leavers, turnover, probation ending, contract and document expiry, on leave, pending approvals, absenteeism, overtime, payroll cost by branch (after H3).

## L. Database and architecture change plan

| Phase | New tables | Changed | Functions / triggers | Accounting |
|---|---|---|---|---|
| H1 | `employee_events` | `employees` (+ nullable fields), permission seeds | event trigger, audit trigger, `import_employees` (validated, all-or-nothing) | none |
| H2 | `leave_types`, `leave_policies`, `holiday_calendars`, `holidays`, `leave_requests`, `leave_request_steps`, `leave_ledger` | — | `submit/approve/reject/cancel_leave`, `leave_balance(emp, type, date)`, monthly accrual job, year-end carry-forward | none (leave liability provision only if D2 says so) |
| H3 | `salary_components`, `employee_salary`, `payroll_line_components`, `loan_schedule` | `payroll_run_items` (component detail), `employee_loans` (stop using stored balance) | run builder, `payslip_data(run, employee)` | same postings; branch dimension after D5 |
| H4 | `hr_requests` | RLS: own-row read policies by `user_id` | — | none |
| H5 | `work_schedules`, `attendance_days`, `attendance_corrections`, `overtime_requests` | — | import, lock | none |
| H6 | `employee_exits`, `exit_checklist_items` | — | `prepare_settlement`, `confirm_settlement` (reuses settle_gratuity, pay_leave_salary, payroll) | existing engines only |

Rules for all: `company_id` + RLS on every table, restrictive right policies like `employees`, no stored balances, append-only ledgers and histories, indexes on every foreign key and on (company, date) filters, CRLF-safe migrations, re-runnable.

### Country compliance architecture
Rules live in **policy rows**, not code. A country pack (UAE mainland, UAE free zone, KSA, India, …) is a set of suggested leave types, policies and a gratuity rule, inserted only when HR accepts it, each marked with its legal source and **"verify before use"** until HR confirms. Free zones (DIFC, ADGM) differ from mainland and are separate packs. Nothing is enabled automatically. Values I can cite (to be verified by the company or its adviser before activation):

| UAE mainland (Federal Decree-Law 33/2021) | Value to verify |
|---|---|
| Annual leave | 2 days/month after 6 months in year one; 30 days/year after one year |
| Sick leave | up to 90 days a year after probation: 15 full pay, 30 half pay, 45 unpaid |
| Maternity | 60 days: 45 full pay, 15 half pay |
| Parental | 5 working days within 6 months of birth |
| Bereavement | 5 days (spouse), 3 days (close relatives) |
| Study | 10 days a year (after 2 years' service) |
| Gratuity | 21 days' basic per year for the first 5 years, 30 days after; needs 1 year's service; cap 2 years' wage |

India and other GCC packs: to be researched and cited separately; none is assumed.

## M. Testing and acceptance criteria

Each phase is accepted only when its tests pass on staging with the 100-employee company:
- Role matrix per new function and table: owner, HR director, HR officer (no salary), payroll accountant, branch manager (own branch only), employee (own records only), other company, anonymous.
- Leave: balance identity (opening + accrued + adjustments + carry-forward − taken = closing) for new joiner, probation, mid-year joiner and leaver, transfer, type change, half day, consecutive, overlapping (refused), unpaid, carry-forward and expiry; no double deduction on re-approve.
- Payroll: joiner/leaver proration, mid-month raise, paid and unpaid leave, bonus, overtime, advance, loan, transfer, deactivation, recalculation, approve twice, pay twice, cancel after approval, payment reversal; run totals = journal; payslip totals = run line; employee sees only own payslip.
- History: transfers, raises and exits keep every past payroll, leave and report row.
- The 23 acceptance workflows of the brief (section 21) run end to end on web, phone width and Arabic, then on the Android build.
- Regression: 312 static tests, unit tests, the phase158/159/163 staging suites, invariants (trial balance, 2350/2360/1450 balances equal their sub-records).
