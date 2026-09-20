# Verification queries

Run these through the regression helper RPC (see the `stockbolt` skill for the
probe pattern) rather than opening a SQL console against production. All are
read-only.

Each query is written to **return zero rows when healthy**, so a non-empty
result is always a finding. That framing matters: a query that returns "the
balance" invites eyeballing, while a query that returns violations makes the
failure impossible to miss.

## 1. Every journal entry balances

```sql
SELECT je.id, je.entry_number, je.date,
       ROUND(SUM(gl.debit), 2)  AS total_debit,
       ROUND(SUM(gl.credit), 2) AS total_credit
FROM journal_entries je
JOIN general_ledger gl ON gl.journal_entry_id = je.id
GROUP BY je.id, je.entry_number, je.date
HAVING ROUND(SUM(gl.debit) - SUM(gl.credit), 2) <> 0;
```

Should never return rows — `je_must_balance` enforces this at commit. If it
does, something wrote to the GL outside the posting engine.

## 2. Trial balance nets to zero per company

```sql
SELECT c.name, ROUND(SUM(gl.debit) - SUM(gl.credit), 2) AS net
FROM general_ledger gl
JOIN companies c ON c.id = gl.company_id
GROUP BY c.name
HAVING ROUND(SUM(gl.debit) - SUM(gl.credit), 2) <> 0;
```

## 3. Accounting equation (Assets = Liabilities + Equity)

Income and expense fold into equity as current-period earnings, exactly as the
Balance Sheet report does. Without that fold the equation will not hold
mid-period, and that is expected, not a bug.

```sql
WITH b AS (
  SELECT coa.type,
         SUM(CASE WHEN coa.type = 'asset' THEN gl.debit - gl.credit
                  ELSE gl.credit - gl.debit END) AS bal
  FROM general_ledger gl
  JOIN chart_of_accounts coa
    ON coa.code = gl.account_code AND coa.company_id = gl.company_id
  WHERE gl.company_id = :company_id AND gl.date <= :as_of
  GROUP BY coa.type
)
SELECT
  ROUND(COALESCE(SUM(bal) FILTER (WHERE type = 'asset'), 0), 2) AS assets,
  ROUND(COALESCE(SUM(bal) FILTER (WHERE type = 'liability'), 0)
      + COALESCE(SUM(bal) FILTER (WHERE type = 'equity'), 0)
      + COALESCE(SUM(bal) FILTER (WHERE type = 'income'), 0)
      - COALESCE(SUM(bal) FILTER (WHERE type = 'expense'), 0), 2) AS liab_plus_equity
FROM b;
```

The two columns must match. A difference equal to net profit means the
current-period-earnings fold is missing somewhere.

## 4. Customer statement reconciles to AR control

Every customer's derived outstanding must equal their AR ledger balance. A
mismatch means a document posted to AR without a contact, or a statement that
computes from source documents instead of the ledger.

```sql
SELECT gl.contact_id, ROUND(SUM(gl.debit - gl.credit), 2) AS ar_balance
FROM general_ledger gl
JOIN chart_of_accounts coa
  ON coa.code = gl.account_code AND coa.company_id = gl.company_id
WHERE gl.company_id = :company_id
  AND coa.code = '1200'          -- Accounts Receivable
GROUP BY gl.contact_id
HAVING ROUND(SUM(gl.debit - gl.credit), 2) <> 0;
```

Compare each row against what the customer statement screen shows. They must
agree to the cent. Repeat with the AP control account for vendors.

Also check for AR/AP movement with no contact attached — these are invisible on
every statement and are a common cause of "the statement doesn't match the
ledger":

```sql
SELECT gl.id, gl.account_code, gl.debit, gl.credit, gl.date
FROM general_ledger gl
WHERE gl.company_id = :company_id
  AND gl.account_code IN ('1200', '2100')
  AND gl.contact_id IS NULL;
```

## 5. Stock valuation ties to the Inventory control account

The stock subledger valued at moving-average cost must equal GL account 1300.
This is the E1 check the regression suite reports as warn-only — investigate a
growing number rather than accepting it.

Known legitimate exception: deferred-COGS legacy rows from sell-before-buy.
Confirm any drift is explained by that before dismissing it.

## 6. Tax reconciles to posted journals

VAT/GST on the return must equal movement on the tax accounts. Anything
computed from documents rather than from the ledger will drift the moment a
document is voided or edited.

```sql
SELECT gl.account_code, ROUND(SUM(gl.credit - gl.debit), 2) AS tax_balance
FROM general_ledger gl
WHERE gl.company_id = :company_id
  AND gl.date BETWEEN :from AND :to
  AND gl.account_code IN ('2200')    -- VAT payable; confirm codes in Document 3
GROUP BY gl.account_code;
```

## 7. Currency lockdown

Until the multi-currency engine is complete, no document may carry a currency
other than the company base, and every exchange rate must be 1.

```sql
SELECT 'invoices' AS tbl, i.id, i.currency, i.exchange_rate
FROM invoices i JOIN companies c ON c.id = i.company_id
WHERE i.currency <> COALESCE(c.base_currency, c.currency) OR i.exchange_rate <> 1
UNION ALL
SELECT 'vendor_bills', vb.id, vb.currency, vb.exchange_rate
FROM vendor_bills vb JOIN companies c ON c.id = vb.company_id
WHERE vb.currency <> COALESCE(c.base_currency, c.currency) OR vb.exchange_rate <> 1;
```

Extend to `sales_quotes`, `purchase_orders`, `credit_notes`, `debit_notes`. Any
row returned is a misstated document — quantify the exposure before deciding
how to respond.

## 8. Duplicate canonical postings

One source document should have at most one live canonical journal entry.
Duplicates indicate a double-post got through.

```sql
SELECT company_id, source_type, source_id, COUNT(*) AS canonical_entries
FROM journal_entries
WHERE reversal_of_id IS NULL AND reversed_by_id IS NULL
GROUP BY company_id, source_type, source_id
HAVING COUNT(*) > 1;
```

Run this before adding the unique index that prevents it — the index build
fails if duplicates already exist, and finding them is itself valuable.

## Before/after comparison for posting changes

The strongest safety evidence is that existing documents are untouched.

1. Pick a representative sample of confirmed documents — ideally one per
   posting path (standard invoice, tax-inclusive invoice, POS sale, invoice
   with round-off, bill with landed costs, credit note with restock).
2. Capture their GL rows: account codes, debits, credits, dates.
3. Apply the change.
4. Re-derive the same documents and diff.

Any difference in a historical document means the change is retroactive. Stop
and reassess — that is a change to books a customer may already have filed.

For changes that *should* alter future behaviour, this comparison is still the
right tool: it proves the change is scoped to new activity only.
