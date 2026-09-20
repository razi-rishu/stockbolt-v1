# Impact analysis

Read before any HIGH or CRITICAL change.

The purpose is not to fill in a form. It is to **find the thing you didn't
think of** — the second report that reads the same column, the third posting
function that copies the same block, the migration that will half-apply. Every
StockBolt production incident so far was a missed second location, not a wrong
first one.

Write the analysis before the code. Writing it afterwards turns it into a
justification exercise, which finds nothing.

## Template

```
CHANGE:            one sentence, plain language
RISK TIER:         LOW | MEDIUM | HIGH | CRITICAL

Affected files
Affected modules
Affected tables
Affected RPCs / functions
Affected reports
Accounting impact       (which statements/balances could move — "none" is a valid answer, but justify it)
Inventory impact        (stock ledger, MAC, COGS)
API impact              (public API contract, adapter signatures)
Permissions impact      (RLS policies, has_perm gates)
Migration required      (yes/no; additive?; idempotent?; data repair?)
Backward compatibility  (do existing confirmed documents reproduce identically?)
Performance impact      (new queries, added rows-per-request, N+1)
Security impact         (tenant scoping, service-role paths, input validation)

Silent-wrongness check: if this change were subtly wrong, what would the user
see? If the answer is "a plausible wrong number" rather than "an error",
say what you are adding to make it fail loudly instead.
```

That last field is the one that matters most. Treat it as mandatory thinking,
not a formality.

## Tracing impact properly

Do not rely on memory or on a single grep. Live definitions drift from the
migration files, so **for posting functions the live database is the truth**.

### Find every posting function that touches a pattern

```bash
# All posting RPCs mentioning a table/account/concept
rg -l "confirm_|void_|edit_|reopen_" supabase/migrations/*.sql

# Which ones write a given account or table
rg -n "5900|deferred_cogs_queue|stock_ledger" supabase/migrations/*.sql | rg "INSERT|UPDATE"
```

Then confirm against the **live** definition before editing — see the
`stockbolt` skill for the `pg_get_functiondef` generator pattern. A fix written
against a stale migration file will silently revert live behaviour.

### Find every report reading a column

Reports live in `src/modules/reports/` (~30 files) and read through
`src/data/supabaseAdapter.ts`. A change to a GL column, account code, or
document status usually touches more of them than expected:

```bash
rg -l "account_code|total_amount|status" src/modules/reports/
rg -n "from\('general_ledger'\)|from\('stock_ledger'\)" src/data/supabaseAdapter.ts
```

### Find sibling editors

Document editors are near-copies of each other. A defect in one is usually in
four. When fixing an editor, check all of them:

```bash
rg -l "currencyOptions|exchange_rate|prices_inclusive" src/modules/
```

This is how the currency-picker defect was found in **four** editors rather
than one.

### Check whether a defect is latent or already live

This changes the urgency completely, and it is cheap to determine. Write a
read-only probe (`scripts/_probe_*.mjs`, delete after) and count the affected
rows in production before deciding how to respond.

Finding "0 rows affected" turns an emergency into a scheduled fix. Finding
"140 rows affected" turns a scheduled fix into a data-repair project. Never
guess which one you are in.

## Worked example

A real analysis, for the currency defect found in the certification audit:

```
CHANGE:      Lock document currency to company base currency in all editors
RISK TIER:   CRITICAL (touches posting inputs on live financial documents)

Affected files    src/modules/sales/invoice-editor.tsx
                  src/modules/sales/quote-editor.tsx
                  src/modules/purchasing/vendor-bill-editor.tsx
                  src/modules/purchasing/po-editor.tsx
Affected modules  Sales, Purchasing
Affected tables   invoices, sales_quotes, vendor_bills, purchase_orders (currency column)
Affected RPCs     none changed — but ~15 posting RPCs are the REASON for the change
                  (they post transaction amounts without multiplying by exchange_rate)
Affected reports  none directly; all GL-derived reports were at risk from the defect
Accounting impact PREVENTS misstatement. No change to existing correct postings.
Inventory impact  none
API impact        none — POST /v1/orders already forces company base currency
Permissions       none
Migration         none required for the UI lock.
                  Optional hardening: CHECK constraint currency = base_currency.
Backward compat   Verified: 0 existing documents use a non-base currency,
                  all exchange_rate values = 1. Nothing reproduces differently.
Performance       none
Security          none

Silent-wrongness check: the defect itself was pure silent wrongness — the JE
balanced (1000 = 1000) so je_must_balance passed and the regression suite
passed. Fix must therefore be structural (remove the input) rather than a
validation message, plus a regression test asserting no document exists with
currency <> base_currency.
```

Note what the analysis surfaced that a quick fix would have missed: the defect
was in **four** editors, the API path was already safe, and the live data was
**clean** — which meant no customer notification and no data repair. All three
facts changed the response.
