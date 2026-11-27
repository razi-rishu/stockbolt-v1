# HRMS — master progress

> Single place to see where the HRMS work stands. Updated at the end of every phase.
> Documents: `01_HR_AUDIT.md` (A–H), `02_ISSUE_REGISTER.md` (J), `03_ROADMAP_AND_ARCHITECTURE.md` (I, K, L, M).

| Phase | Name | Status | Staging tests | Production | Web | Android |
|---|---|---|---|---|---|---|
| phase163 | Employee 360 page, documents, private files | Done | E1–E19 pass | Applied 2026-11-26 | Pushed (f409628) | 1.0.29 (code 30) built |
| H0 | Card opens profile; Edit, Deactivate explicit | Done 2026-11-27, uncommitted | Desktop, tablet, phone: profile has 0 editable fields; Edit → save → profile | No SQL | Not pushed | Next build |
| H1 | HR foundations: fields, employment history, audit, directory, import/export, 100-employee seed | Done 2026-11-27, uncommitted (phase164) | H1–H16 pass; 100 imported via the app's import; screen: filters, search, paging, transfer + raise → timeline; phone | Not applied | Not pushed | Next build |
| H2 | Leave engine | Waiting (D1, D2) | — | — | — | — |
| H3 | Payroll upgrade + payslips | Waiting (D2, D5) | — | — | — | — |
| H4 | Self-service | Waiting (D3) | — | — | — | — |
| H5 | Attendance light | Waiting | — | — | — | — |
| H6 | Exit workflow | Waiting | — | — | — | — |
| H7 | HR dashboard and reports | Waiting | — | — | — | — |

### H1 notes
- **HR roles without salary moved to H3.** Salary sits on the employee row today, so a role that may read the employee but not the salary can only be enforced by the database once salary has its own table (H3). Hiding it on screen alone would not be secure. Until then every HR user needs payroll.read, as now.
- **Test company on staging:** "HR Sim Trading LLC", 101 employees (owner + 100 imported) across Head Office (34), Branch A, B, C (22 each), nine departments, five employment types. Created through onboarding and `import_employees`, never by direct inserts. Local staging only.
- Directory loads 101 employees in about 2.5 s on staging (all rows once, filters instant, 50 per page). Server-side paging is planned only if companies pass ~1,000 employees.

## Decisions needed

| ID | Question | Recommendation |
|---|---|---|
| D1 | Country leave and gratuity rules: ship editable templates marked "verify before use", or leave every company to type its own? | Templates, off until HR confirms each one |
| D2 | Should annual leave liability be provisioned in the books every month (needs a Document 3 rule), or only paid when taken / encashed (today)? | Keep today's method in H2; decide provisioning separately |
| D3 | Self-service needs a login per employee. Do employee logins count toward the plan / user limits? | Free "employee" logins limited to My HR |
| D4 | Split payroll approval from payroll entry (`payroll.approve`)? | Yes |
| D5 | Add a branch to payroll journal lines (needs Document 3 update)? | Yes, in H3 |

## Acceptance test (brief section 21) — current state

| # | Workflow | State |
|---|---|---|
| 1–4 | Create employee, branch directory, card opens profile, update | All pass on staging (H0 + H1) |
| 5–10 | Leave requests, approvals, balances, medical leave, attendance | Not built (H2, H5) |
| 11–17 | Payroll with leave, approval, payslip, journals, branch report | Payroll and journals work; leave link, payslip and branch report not built (H2, H3) |
| 18–19 | Transfer with history kept | Partly: branch transfer recorded with old/new (H1). Past payroll staying intact after a transfer is tested in H3 |
| 20–23 | Resignation, final settlement, access removal, history kept | Partial: gratuity settlement and deactivation only (H6) |

**Readiness: not a complete HRMS.** The employee record and monthly payroll posting are solid; leave, payslips, self-service, attendance and exits are missing.
