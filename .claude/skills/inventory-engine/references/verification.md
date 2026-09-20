### Inventory verification

Read at verification time. Run through the regression helper RPC as a read-only
probe (see the `stockbolt` skill), and delete the probe afterwards.

Queries are written to **return zero rows when healthy**, so any output is a
finding rather than something to interpret.

## 1. E1 — stock valuation vs GL 1300 (the master check)

The stock subledger valued at MAC must equal the Inventory control account, per
company. This is the single most important inventory assertion: if it holds,
quantity and value agree with the books; if it drifts, something in the costing
path is wrong.

```sql
WITH stock AS (
  SELECT sl.company_id,
         SUM(sl.direction * sl.quantity * sl.running_avg_cost) AS subledger_value
  FROM public.stock_ledger sl
  WHERE sl.product_id IS NOT NULL
  GROUP BY sl.company_id
),
gl AS (
  SELECT g.company_id, SUM(g.debit - g.credit) AS gl_value
  FROM public.general_ledger g
  WHERE g.account_code = '1300'
  GROUP BY g.company_id
)
SELECT c.name,
       ROUND(COALESCE(s.subledger_value, 0), 2) AS stock_value,
       ROUND(COALESCE(g.gl_value, 0), 2)        AS gl_1300,
       ROUND(COALESCE(s.subledger_value, 0) - COALESCE(g.gl_value, 0), 2) AS drift
FROM public.companies c
LEFT JOIN stock s ON s.company_id = c.id
LEFT JOIN gl    g ON g.company_id = c.id
WHERE ABS(COALESCE(s.subledger_value, 0) - COALESCE(g.gl_value, 0)) > 1.00;
```

**Before calling drift a defect, check the deferred-COGS queue** (§3). A pending
queue produces a legitimate gap. Anything unexplained by the queue is real, and
a drift that grows over time always is.

## 2. On-hand quantity per product

```sql
SELECT sl.product_id, p.sku,
       SUM(sl.direction * sl.quantity) AS on_hand
FROM public.stock_ledger sl
JOIN public.products p ON p.id = sl.product_id
WHERE sl.company_id = :company_id
GROUP BY sl.product_id, p.sku
ORDER BY on_hand;
```

Negative values are valid only where backorders are enabled. Cross-check
against `companies.allow_negative_stock`; negative stock on a company with
backorders **disabled** means the guard was bypassed — investigate immediately,
because it implies a write path that skipped the trigger.

## 3. Deferred COGS queue

```sql
SELECT d.company_id, COUNT(*) AS pending_rows, SUM(d.quantity) AS pending_qty
FROM public.deferred_cogs_queue d
WHERE d.flushed_at IS NULL
GROUP BY d.company_id;
```

Run this whenever E1 drifts. Pending rows explain the gap; zero pending rows
with drift present means the cause is elsewhere.

## 4. Movements that skipped the ledger

Every confirmed document that touches stock must have matching ledger rows.
Confirmed invoices with stock-tracked lines but no ledger rows indicate a
posting path that bypassed inventory:

```sql
SELECT i.id, i.invoice_number, i.date
FROM public.invoices i
WHERE i.company_id = :company_id
  AND i.status = 'confirmed'
  AND EXISTS (
    SELECT 1 FROM public.invoice_items ii
    JOIN public.products p ON p.id = ii.product_id
    WHERE ii.invoice_id = i.id AND COALESCE(p.is_service, false) = false)
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_ledger sl
    WHERE sl.company_id = i.company_id
      AND sl.related_doc_id = i.id);
```

Adjust the join to the actual service flag and document-link columns before
relying on this — confirm names against the schema rather than assuming.

## 5. Services must not appear in the ledger

```sql
SELECT sl.id, p.sku, p.name
FROM public.stock_ledger sl
JOIN public.products p ON p.id = sl.product_id
WHERE sl.company_id = :company_id
  AND COALESCE(p.is_service, false) = true;
```

Pre-existing rows from before services were separated are legacy; new ones are
a regression.

## 6. Orphan movements

Stock must always belong to a company, product and warehouse:

```sql
SELECT id, company_id, product_id, warehouse_id, quantity
FROM public.stock_ledger
WHERE company_id IS NULL OR product_id IS NULL OR warehouse_id IS NULL;
```

## 7. MAC sanity

Running cost should never be negative, and a zero cost on a valued inward
movement usually means a cost was not carried through:

```sql
SELECT sl.id, p.sku, sl.direction, sl.quantity, sl.running_avg_cost, sl.seq
FROM public.stock_ledger sl
JOIN public.products p ON p.id = sl.product_id
WHERE sl.company_id = :company_id
  AND (sl.running_avg_cost < 0
       OR (sl.direction > 0 AND sl.running_avg_cost = 0))
ORDER BY sl.seq;
```

## Scenario tests for costing changes

Structural checks prove the machinery exists; only these prove it computes
correctly. Run them on a scratch company — never on tenant data.

For each scenario, assert **quantity, MAC, inventory value, COGS, and GL 1300
together**. Checking quantity alone is how cost bugs slip through: the count is
usually right, the value is not.

| Scenario | What it proves |
|---|---|
| Opening stock → sell part | Baseline MAC and COGS |
| Purchase at a different price → sell | MAC recalculates on inward only |
| Sell → verify MAC unchanged | Outward movements don't move the average |
| Purchase with landed costs → sell | Landed cost is capitalised into MAC |
| Sell with no stock (backorders on) → purchase | Deferred COGS queues then flushes at the new cost |
| Sell with no stock (backorders off) | The guard rejects it |
| Sales return with restock | Restocks at the **original** cost, not today's MAC |
| Purchase return | Reduces quantity and value symmetrically |
| Transfer between warehouses | Quantities move; total value and MAC unchanged; no GL impact |
| Void a confirmed invoice | Stock and COGS reverse at the original cost **and original date** |
| Edit and repost an invoice | Net effect equals a single correct posting — no double reversal |
| Service product on an invoice | No ledger rows, no COGS |

The void and edit cases are the highest-value tests: reversal paths are where
costing bugs concentrate, because they must reproduce a historical cost rather
than compute a current one.

## Interpreting a discrepancy

Work in this order — it goes from most to least likely, and each step rules out
a whole class of cause:

1. **Deferred COGS pending?** → explains the gap; not a defect.
2. **Ordering by `seq`?** → a query ordering by `created_at, id` will report
   phantom drift that does not exist in the data.
3. **Negative stock with backorders off?** → a write path bypassed the guard.
4. **A purchase cost edited after its stock was sold?** → COGS is understated
   and nothing detects it automatically.
5. **Services in the ledger?** → a posting path lost its service check.
6. **Genuine drift** → `recompute_stock_valuation()` repairs it, but establish
   the cause first. Recomputing without understanding why only hides the defect
   until it recurs.
