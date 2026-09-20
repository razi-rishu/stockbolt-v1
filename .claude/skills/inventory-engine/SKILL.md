---
name: inventory-engine
description: How StockBolt's inventory subledger actually works — moving-average cost, the stock ledger, COGS, deferred COGS for sell-before-buy, negative-stock/backorder handling, warehouse transfers, and the reconciliation between stock valuation and the Inventory GL account. Use this skill for ANY inventory work: stock movements, product costing, MAC, COGS, stock adjustments, transfers, opening stock, goods receipts, returns that restock, inventory valuation reports, or the stock ledger. Also use it for diagnostic questions like "why is my inventory value wrong?", "why did MAC change?", or "why is stock negative?" — even when no code is being changed, because inventory errors surface as accounting errors and are usually misdiagnosed as report bugs.
---

# Inventory engine — costing and the stock subledger

For accounting identities and posting correctness generally, use
`accounting-engine`. For change-control process, use `erp-guardian`. For SQL and
migration craft, use `database-guardian`. This skill is the inventory-specific
layer those three defer to.

## The mental model that prevents most mistakes

Inventory is not a quantity in a table. **It is a subledger of the balance
sheet.** Every movement is simultaneously a *quantity* event and a *value*
event, and the running total of those values must equal GL account **1300
(Inventory)** — forever, for every company, at every date.

That single fact explains nearly every rule below. "Reduce the stock by 5" is
never a complete instruction, because it leaves unanswered the question the
accounts care about: *at what cost?* Answer that wrong and the error does not
appear in inventory — it appears months later as an unexplained gap between the
stock valuation report and the balance sheet, at which point the history needed
to fix it has been buried under thousands of subsequent movements.

Inventory is also **event-sourced**. `stock_ledger` is an append-only history;
current stock is *derived* by replaying it, not stored. So corrections are new
events, never edits to old ones. Editing history silently changes every
downstream valuation that was computed from it.

## What actually exists here

Generic inventory advice will lead you to write code against features this
system does not have. Verified state:

| Capability | Status |
|---|---|
| Moving-average cost (MAC) | ✅ Built — the only costing method. No FIFO/LIFO. |
| `stock_ledger` append-only history with `seq` | ✅ Built |
| COGS on sale, from the costing engine | ✅ Built |
| Deferred COGS (sell-before-buy) | ✅ Built — queue flushed at the next purchase cost |
| Negative-stock guard + per-company backorder toggle | ✅ Built, DB-enforced |
| Multi-warehouse + transfers | ✅ Built |
| Opening stock | ✅ Built |
| Serial numbers | ✅ Built — `product_serials`, `products.requires_serial` |
| Services excluded from inventory | ✅ Built |
| Stock valuation vs GL 1300 check ("E1") | ✅ Built as a warn-only regression tripwire |
| **Reservations / "available vs on-hand"** | ❌ **Does not exist.** No reserved quantity anywhere. |
| **Batch / lot numbers, expiry tracking** | ❌ **Does not exist.** |
| **Stocktake / cycle-count workflow** | ❌ **Does not exist** as a workflow. `stock_count` exists only as an *adjustment reason code* — a physical count is entered as a normal stock adjustment. |
| Bin / location management | ❌ Does not exist |

Because reservations do not exist, **there is no "available quantity"**
distinct from on-hand. The valuation identity here is:

```
Inventory value = on-hand quantity × moving average cost
```

If a task assumes reservations, batches, or a stocktake screen, say so before
writing code rather than inventing a partial version. A half-built inventory
feature produces wrong stock values, and wrong stock values become wrong COGS,
which becomes a wrong P&L.

## Invariants

**MAC changes only when inventory comes *in*.** Purchases, goods receipts,
opening stock and restocking returns recalculate the weighted average. Sales,
transfers and quantity-only adjustments consume stock at the current MAC and
must leave it unchanged. *Why:* moving average is a property of what you paid
to acquire what you hold; issuing stock does not change what you paid.

**Never recalculate historical MAC.** A past sale's cost is a historical fact.
The one sanctioned exception is `recompute_stock_valuation()`, which re-derives
the running cost from source data to repair drift — that is a repair tool, not
a routine operation.

**Every read of "latest stock state" orders by `stock_ledger.seq`.** Never
`created_at DESC, id DESC`. *Why:* rows written in the same transaction share a
timestamp, and the uuid tiebreak is arbitrary — this produced real phantom
valuation drift in production. `seq` is monotonic and unique; it is the only
correct ordering.

**Every movement writes a stock ledger row.** No code path may change stock
without one — not an adjustment, not a repair, not an import. The ledger *is*
the quantity; a direct update that skips it makes the derived quantity diverge
from the history that explains it.

**COGS comes from the costing engine.** Never compute cost of sale from selling
price, margin, or the product's current cost field. COGS must be the cost the
engine assigned at that moment, so that inventory relieved and expense
recognised are the same number.

**Transfers move quantity, not value.** Reducing one warehouse and increasing
another leaves total valuation and MAC untouched, and posts no P&L impact.

**Services never touch inventory.** Service products write no stock ledger rows
and generate no COGS.

**Products with movement are deactivated, never deleted.** Historical documents
must keep resolving.

## Negative stock and deferred COGS

This is the subtlest part of the engine and the most common source of
misdiagnosis.

When stock is sold that was never purchased, there is no cost to relieve. The
system's answer depends on the company's backorder setting:

- **Backorders disabled** — the negative-stock trigger rejects the movement.
  The sale cannot be confirmed. This is a guard, not a bug.
- **Backorders enabled** — the sale proceeds and the missing cost goes into
  `deferred_cogs_queue`. When stock is next purchased, the queue is flushed at
  that purchase's cost and the deferred COGS is recognised then.

Two consequences worth holding onto:

1. **A tenant with deferred-COGS history will show a legitimate gap** between
   stock valuation and GL 1300 until the queue flushes. When investigating an
   E1 discrepancy, check the deferred queue before concluding something is
   broken.
2. **Editing a purchase cost after its stock has already been sold understates
   COGS**, and no automatic check catches it — the subledger and the GL agree
   with each other while both being wrong. If a task involves editing historic
   purchase costs, flag this explicitly.

## Where inventory meets the ledger

| Event | Quantity | Value / GL |
|---|---|---|
| Goods receipt / purchase | ↑ | Dr Inventory 1300, Cr AP — MAC recalculated |
| Sale confirm | ↓ | Dr COGS 5000s, Cr Inventory 1300 at MAC |
| Sales return with restock | ↑ | Reverses COGS and Inventory at the original cost |
| Purchase return | ↓ | Reverses Inventory and AP |
| Adjustment (increase) | ↑ | Dr Inventory, Cr the adjustment/variance account |
| Adjustment (decrease) | ↓ | Cr Inventory, Dr shrinkage/variance |
| Transfer | ↔ | No GL impact |

A restocking return uses the **original** cost, not today's MAC — otherwise
returning goods would silently create or destroy value.

Stock adjustments always carry a reason (`stock_count`, `damage`, `shrinkage`,
`found`, `other`), post to the GL, and are audit-logged. Stock never changes
without an explanation attached; "the number was wrong" is not a reason a
future auditor can act on.

## Verifying

The master check is **E1: stock valuation must equal GL 1300**, per company.
The regression suite reports drift as a warning rather than a failure so a
single tenant's data quirk cannot block unrelated work — but a growing number
is a real defect, not noise. Investigate rather than accept it.

`references/verification.md` has the queries: E1 reconciliation, MAC continuity,
orphan-movement detection, negative-stock scan, and per-scenario checks.

Two traps specific to inventory:

- **A correct quantity does not imply a correct value.** Most inventory bugs
  keep the count right and get the cost wrong, which is precisely why they
  surface as accounting discrepancies rather than stock complaints.
- **The regression suite is structural.** It asserts the triggers and functions
  exist; it does not prove a purchase→sale→return cycle produces the right
  numbers. For costing changes, verify numerically.

## When to stop and ask

- The task needs reservations, batches, or a stocktake workflow — none exist.
- A change would recalculate historical MAC or cost of past sales.
- A fix requires editing `stock_ledger` rows rather than appending.
- E1 drift is present and you cannot attribute it to deferred COGS.
- A purchase cost would be edited after that stock has been sold.
- Costing method would change (FIFO/LIFO) — that is a rebuild, not a setting.

## Reporting inventory work

```
Inventory impact    — quantity effects, MAC effects, which movements are written
Accounting impact   — GL accounts touched; does E1 still reconcile?
Warehouse impact    — which warehouses, and whether valuation moves
Reports affected    — stock ledger, valuation, dashboard stock cards, P&L via COGS
Verification        — what you ran and the actual numbers before/after
Rollback            — how to undo; for stock, usually a compensating movement
Confidence          — high / medium / low, and what would raise it
```

Rollback deserves thought here: because the ledger is append-only, "undo"
normally means posting a compensating movement, not deleting rows. Say which
you mean.

## References

- **`references/mac-and-cogs.md`** — how moving average is computed, worked
  numeric examples, deferred COGS walkthrough, and the edit-after-sale problem.
  Read before changing anything that touches cost.
- **`references/verification.md`** — E1 reconciliation and the per-scenario
  numeric checks. Read at verification time.
