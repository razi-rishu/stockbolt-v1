# HRMS issue register (section J)

> 2026-11-27. P0 security, data integrity, financial corruption · P1 core HR and wrong money · P2 operations and reporting · P3 usability.
> "To verify" = found by reading code; the staging test that proves it is part of the phase that fixes it.

| ID | P | Title | Root cause | Affected | Business / financial impact | Status |
|---|---|---|---|---|---|---|
| HR-01 | P1 | Employee card opened the edit form | Employee 360 rendered the form for every open | `employee-360/index.tsx`, `employees.tsx` | Accidental edits to employee data | **Fixed (H0)**, *verified* desktop, tablet, phone |
| HR-02 | P1 | Leave salary earned at 30 days a year from day one, for every country | Hard-coded constant `ANNUAL_LEAVE_DAYS = 30`, accrual from joining date | `leave-salary.tsx` | First-year UAE staff and non-UAE staff can be overpaid leave salary; leave taken is never recorded, so balances only fall when cash is paid | Open → H2 |
| HR-03 | P1 | Gratuity uses the UAE formula for all countries, with no minimum service | Hard-coded in `gratuity.ts` (21/30 days of basic, 2-year cap) | Employee list, final settlement default, payroll accrual (to verify source) | India gratuity differs (statutory 15 days per year after 5 years); UAE requires 1 year's service. Wrong liability (2360) and wrong settlement default | Open → H3/H6 |
| HR-04 | P1 | No payslips | Never built | Payroll | Employers cannot give staff a payslip (a WPS and labour-law expectation in many countries) | Open → H3 |
| HR-05 | P1 | Unpaid leave, overtime and loan recovery typed by hand per run | No leave, attendance or loan link | Payroll run editor | Errors and double deductions possible; no trace of why a deduction was made | Open → H2/H3/H5 |
| HR-06 | P1 | Salary changes overwrite the record; no effective date or history | No salary structure table | `employees` | Mid-month raises and back pay done by hand; no record of past salaries for audits or disputes | History part **fixed (H1, phase164)**: salary revisions recorded with old/new; effective-dated salary still H3 |
| HR-07 | P1 | No HR role split: anyone who can see an employee sees salary; employees see nothing of their own | Single `payroll.read` gate (phase130) | RLS on `employees` and payroll tables | Cannot delegate HR work without exposing pay; no self-service | Open → **H3** (salary moves to its own table, then an HR role without salary is possible at the database level) and H4 |
| HR-08 | P2 | Employee field edits and status changes are not audited | Audit only on Team and posting functions | `employees` | No trail for who changed bank details or salary (fraud risk) | **Fixed (H1, phase164)**, *verified* H3–H4 |
| HR-09 | P2 | `employee_loans.balance` is a stored running figure | Built before the ledger-first rule was applied to payroll | `employee_loans` | Can drift from 1450 and from recoveries (AGENTS Rule 1) | Open → H3 (to verify) |
| HR-10 | P2 | Payroll cannot be reported by branch | One journal per run, no branch on lines | `confirm_payroll_run` | Branch profit understated / unknown | Open → H3 (needs Doc 3 decision) |
| HR-11 | P2 | No leave management at all | Never built | — | HR tracks leave on paper; payroll cannot read it | Open → H2 |
| HR-12 | P2 | No attendance, schedules or holidays | Never built | — | Overtime and absence cannot be checked | Open → H5 |
| HR-13 | P2 | No probation, confirmation, contract dates, gender, marital status, address, work schedule | Fields not modelled | `employees` | Probation and contract expiry cannot be tracked | **Fixed (H1, phase164)**, *verified* H5 |
| HR-14 | P2 | No directory filters, bulk import/export, branch scoping | Small-company design | `employees.tsx` | A 100-person company manages one long list by hand | Filters, search, paging, export, validated import **fixed (H1)**, *verified* 101 employees; branch-scoped access moves to H4 |
| HR-15 | P2 | Exit is only "final settlement" of gratuity | No exit workflow | `final-settlement-modal.tsx` | Leave encashment, last salary, loan recovery and login removal are separate manual steps | Open → H6 |
| HR-16 | P2 | Photo and document upload not tested end to end | Staging has no Storage | phase163 | Unknown until tried once on production | Open (Rashid to try once) |
| HR-17 | P3 | No HR dashboard or HR reports | Never built | — | No overview of headcount, expiries, leave, cost | Open → H7 |
| HR-18 | P3 | Employment types do not include permanent / probation / temporary | Constraint list from phase163 | `employees_employment_type_check` | Wording only; probation belongs in its own date field | **Fixed (H1, phase164)** |
| HR-19 | P3 | Leave salary history and payroll history are the only histories on the profile | Modules missing | Employee 360 | Attendance, leave requests, performance, assets not shown (not built) | Open → H2–H6 |

**P0: none found.** Company isolation, document privacy and posting rights held in every test (phase158, phase163 E11–E16).
