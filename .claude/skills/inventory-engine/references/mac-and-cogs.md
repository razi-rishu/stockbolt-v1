### Moving average cost and COGS

Read before changing anything that touches cost.

## How moving average works

MAC is a running weighted average of what you paid for what you currently hold.
It is recalculated **only on inward movements**:

```
new_mac = (qty_on_hand × current_mac + qty_received × receipt_unit_cost)
          ÷ (qty_on_hand + qty_received)
```

Outward movements (sales, decreases, transfers out) consume at the current MAC
and leave it unchanged.

### Worked example

| # | Event | Qty in | Cost/unit | On hand | MAC | Value |
|---|---|---:|---:|---:|---:|---:|
| 1 | Opening stock | 10 | 100.00 | 10 | 100.00 | 1,000.00 |
| 2 | Purchase | 10 | 120.00 | 20 | **110.00** | 2,200.00 |
| 3 | Sell 5 | — | — | 15 | 110.00 | 1,650.00 |
| 4 | Purchase | 5 | 140.00 | 20 | **117.50** | 2,350.00 |
| 5 | Sell 10 | — | — | 10 | 117.50 | 1,175.00 |

Row 2: `(10×100 + 10×120) ÷ 20 = 110.00`
Row 3: sale relieves `5 × 110.00 = 550.00` to COGS. **MAC unchanged** — this is
the rule people most often break.
Row 4: `(15×110 + 5×140) ÷ 20 = 117.50`

The GL must mirror this exactly: after row 5, account 1300 holds 1,175.00 and
cumulative COGS is 550.00 + 1,175.00 = 1,725.00.

### Why sales must not move MAC

If a sale changed the average, the cost of goods sold would depend on the order
you sold things rather than on what you paid — and reversing a sale could no
longer restore the previous state. Keeping MAC an inward-only function is what
makes returns and reversals cleanly undoable.

## Landed costs

Freight, duty and clearing charges attached to a purchase are part of what you
paid to acquire the goods, so they belong in the receipt cost that feeds MAC —
not in an expense account. Itemised landed costs post their own GL legs and
raise the effective unit cost. When touching purchase costing, check whether
landed costs are present; ignoring them undervalues inventory and overstates
margin.

## COGS

COGS is recognised when stock leaves, at the cost the engine assigns at that
moment, and is written to the invoice line (`cost_at_sale`) so the document
carries its own historical cost.

Never derive COGS from selling price or a margin assumption, and never read the
product's *current* cost for a *past* sale. Both produce a COGS that disagrees
with the inventory actually relieved, which breaks the identity that Inventory
credited equals COGS debited.

`cost_at_sale` is internal margin data — it is deliberately excluded from the
public API's field allow-lists. Keep it that way when adding endpoints.

## Deferred COGS — sell before buy

When stock is sold that was never purchased, there is no cost to relieve. With
backorders enabled, the sale proceeds, revenue is recognised, and the missing
cost is queued in `deferred_cogs_queue`. The queue flushes at the next
purchase's cost.

```
Day 1  Sell 5 units, none on hand
       Dr AR / Cr Revenue          ← recognised now
       COGS: nothing to relieve    ← queued, on hand = −5

Day 3  Purchase 20 units @ 90.00
       Dr Inventory 1,800 / Cr AP 1,800
       Queue flush: 5 × 90.00 = 450.00
       Dr COGS 450 / Cr Inventory 450
       On hand = 15, valued at 1,350.00
```

### Consequences worth remembering

**A pending queue is a legitimate E1 gap.** Between day 1 and day 3, stock
valuation and GL 1300 disagree by design, because revenue has been recognised
without its matching cost. Before treating E1 drift as a defect, check the
queue.

**Editing a purchase cost after its stock is sold understates COGS.** The queue
flushed at the old cost; changing the purchase afterwards updates inventory but
not the already-recognised COGS. Nothing detects this — the subledger and GL
still agree with each other, both wrong. If a task involves editing historic
purchase costs, raise it explicitly rather than assuming a guard exists.

**Negative on-hand is a valid intermediate state** when backorders are enabled.
Reports and dashboards must handle it rather than clamping to zero — a
dashboard that displays 0 for negative stock hides the very condition someone
needs to act on.

## Returns and reversals

A restocking sales return puts stock back **at the original cost of that sale**,
not today's MAC. Using today's MAC would let a return create or destroy value:
buy at 100, sell, price rises to 140, customer returns — restocking at 140 would
invent 40 of profit from a cancelled transaction.

The same principle governs void and edit-repost: reverse at the original cost
and the original date, then re-post fresh. This is why reversal entries carry
the original voucher date.

## Recompute — the repair tool

`recompute_stock_valuation()` re-derives running cost from source data across
the ledger. It exists to repair drift, and it is the sanctioned exception to
"never recalculate historical MAC".

Treat it as a repair, not routine maintenance: run it deliberately, know why
drift occurred, and re-check E1 afterwards. Running it to make a number look
right without understanding the cause hides the actual defect and guarantees
the drift returns.

## Changing costing method

MAC is assumed throughout the engine, the reports, the regression tests and the
stored `running_avg_cost` history. FIFO or LIFO is not a configuration change —
it is a different subledger with per-layer cost tracking, a different reversal
model, and a full historical restatement.

Doc 5 explicitly scopes StockBolt to MAC-only. If asked for FIFO/LIFO, say
plainly that it is a rebuild and size it as such.
