---
name: performance-guardian
description: How to think about performance in StockBolt ERP — measuring before optimizing, keeping queries bounded so they never silently truncate, avoiding React re-render and N+1 traps, and knowing when NOT to optimize because the data is still tiny. Use this skill when a screen or report feels slow, when handling large datasets or pagination, when reviewing render/query/bundle efficiency, or when tempted to optimize. Especially use it before any speculative optimization, because the biggest "performance" risk here is a query that returns wrong numbers at scale, not one that's merely slow — and premature optimization on a live financial codebase adds risk for no benefit.
---

# Performance guardian — fast without breaking correctness

For the database side of performance — query bounds, indexing, N+1, the
PostgREST row cap, `EXPLAIN ANALYZE` — use `database-guardian`
(`references/query-and-index.md`), which owns that craft. This skill owns the
**judgment**: when to optimize at all, how to measure, the app-side (React /
bundle / network) traps, and the one performance issue here that is really a
correctness bug.

## Two facts that should reshape the instinct

**1. The data is tiny today.** The entire database is on the order of ~600
general-ledger rows; the largest tenant has ~120. Nothing is slow, and it won't
be for a while. So the honest default for a "make it faster" impulse is
**usually "don't"** — there is no bottleneck to fix, and on a live financial
codebase every change you make to chase a millisecond is a change that could
regress a posting path or a report for zero user-visible benefit. Optimize when
something is *measured* slow or *provably* won't scale, not because a pattern
looks improvable.

**2. The real risk isn't slowness — it's silent wrongness at scale.** The one
genuinely important "performance" issue in this codebase is that reports
aggregate GL rows **in the browser** with unbounded queries, and PostgREST caps
responses (1,000 rows by default). Past that cap the query does not error — it
**truncates**, and the Balance Sheet / Trial Balance / P&L quietly compute a
*wrong total*. That is not a speed problem; it is a correctness time-bomb that
happens to live in the performance domain. Fixing it (server-side aggregation)
is the highest-value perf work in the project, and it matters because it
prevents a wrong number in a customer's books, not because it shaves latency.

Hold both: **don't optimize what isn't slow, but do fix what will silently lie.**

## The discipline: measure, then decide, then verify

Never optimize on a hunch. The sequence is:

1. **Reproduce and measure.** Which screen, which query, how slow, at what data
   volume? "Feels slow" is not a bottleneck; a number is. Use the browser
   Network/Performance panel for the frontend, `EXPLAIN (ANALYZE, BUFFERS)` for
   a query (see `database-guardian`).
2. **Find the actual bottleneck.** It is usually one thing — an unbounded fetch,
   an N+1 loop, a query with no index, a component re-rendering on every
   keystroke. Optimizing anything else is wasted.
3. **Decide if it's worth it.** At current scale, often the honest answer is
   "correct but not yet worth optimizing — note it for when data grows." Say
   that rather than manufacturing a change.
4. **Change the one thing, minimally.** Don't refactor around it (see
   `coding-standards` — the tidy-up urge is a liability here).
5. **Verify it actually helped, and broke nothing.** Re-measure. And for
   anything touching a report or posting path, confirm the *numbers* are
   unchanged (`test-engine`, `accounting-engine`) — a faster report that returns
   a different total is a catastrophic "win".

## Correctness constraints that override speed

Performance never buys any of these back:

- **Never cache financial or inventory data** — GL balances, stock quantities,
  MAC, outstanding, permissions. These are derived from the ledger on purpose
  (no cached aggregates — see `accounting-engine`). A cached total that drifts
  from the ledger is exactly the class of bug the architecture exists to
  prevent. Cache only genuinely static reference data (currency lists, country
  config), and only where invalidation is obvious.
- **Never drop a query's `company_id` scope for speed.** Tenant isolation is not
  negotiable (`security-guardian`).
- **Never skip a posting step, a stock-ledger write, or a guard to go faster.**
  Correctness of the books outranks every latency target.

## Where performance actually lives here

Ordered by where problems realistically appear in *this* app, not by generic
ranking:

**Bounded queries (the big one).** Every `.select()` on a table that grows with
usage must be aggregated in SQL or explicitly bounded — both for speed and,
more importantly, to never truncate silently. This is the E-1 issue.
`database-guardian` `references/query-and-index.md` has the fix patterns
(SQL aggregate RPC; or fail-loud row-count guard) — use them; don't re-derive.

**N+1 fetches.** A list that fetches per row (one query per invoice to get its
customer) instead of an embedded join. Build lookup maps once, outside the loop;
use PostgREST embedded selects. Detail and patterns in `database-guardian`.

**React re-renders.** The app-side trap. A parent re-rendering its whole subtree
on every keystroke, an expensive computation in render instead of `useMemo`, a
new object/array literal passed as a prop defeating memoization, a `useEffect`
over-firing. See `references/react-performance.md`.

**Indexing.** Add an index because a *measured* query needs it, not defensively
— every index costs writes and storage. `company_id` on tenant tables and FK
join columns are the reliable wins. Full guidance in `database-guardian`.

**Bundle / code-splitting.** Already handled well (117 lazily-loaded routes,
sane TanStack Query defaults, no realtime subscriptions). Don't add heavy
dependencies; lazy-load a genuinely large module rather than eagerly importing
it. Note the `xlsx` cautionary tale (`security-guardian`).

## Scaling reality check

When someone asks "will this scale to N companies / M records", answer from the
architecture, not optimism:

- Fine today and for the foreseeable near term at current volumes.
- The **client-side aggregation ceiling** is the first wall — reports break
  (silently, via truncation) at ~1,000 GL rows per company long before anything
  feels slow. Server-side aggregation is the unlock, and it's a correctness fix
  first.
- Beyond that, list pagination (keyset) and selective indexing carry a long way.
- Genuine large-scale (millions of rows/tenant) would need partitioning and
  materialized rollups — real work, not a config flag. Size it honestly if
  asked; don't wave it through.

## When to stop and ask / when to decline

- The optimization would cache financial/inventory/permission data, or weaken
  tenant scoping — decline and explain.
- The change touches a posting or report path and you cannot re-verify the
  numbers are identical — stop.
- There is no measured bottleneck — say "correct and fast enough at current
  scale; noting it as a future item" rather than optimizing speculatively.
- A real fix (server-side report aggregation) is large — flag it as net-new work
  framed as the correctness fix it is, not a quick tweak.

## Reporting performance work

```
Bottleneck        — what you measured, at what data volume (a number, not "felt slow")
Was it worth it   — honestly: real win, or "fine at current scale, deferred"
Change            — the one thing altered, minimally
Correctness       — for report/posting paths: confirmed the numbers are unchanged
Before / after    — the measurement, re-run
Trade-offs        — index write-cost, added complexity, memory
Confidence        — high / medium / low
```

The "was it worth it" line is the honest core. On a codebase this size the most
valuable performance answer is frequently "no change needed yet" — and saying so
is better engineering than a change that adds risk to a live ledger for a
latency nobody would notice.

## References

- **`references/react-performance.md`** — the app-side traps: re-render causes,
  `useMemo`/`useCallback` when they actually help (and when they're noise),
  TanStack Query cache behaviour, list virtualization, and how to measure a
  render in the browser. Read for frontend slowness.
- For all **database** performance (bounds, N+1, indexes, `EXPLAIN`, the row
  cap): `database-guardian` → `references/query-and-index.md`.
