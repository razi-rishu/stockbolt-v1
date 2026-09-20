### Queries, bounds and indexes

Read when writing data-access code or diagnosing something slow.

## The row cap is a correctness issue, not a performance one

PostgREST caps every response (1,000 rows by default). Exceeding it does not
raise an error — the response is simply **truncated**. Client code that
aggregates the result then computes a confidently wrong total.

This is not hypothetical: the Balance Sheet fetches all GL rows for a company
and sums them in JavaScript. It is correct today only because every tenant is
below the cap. A confirmed invoice writes 4–6 GL rows, so the threshold arrives
at roughly 170–250 invoices — months away for an active customer, and it will
arrive silently.

So the rule is not "paginate for speed". It is:

**Any `.select()` on a table that grows with usage must be either aggregated in
SQL or explicitly bounded — and if bounded, it must be able to tell when it hit
the boundary.**

### Aggregate in SQL (preferred)

Return the answer, not the raw material. A Balance Sheet should return ~30 rows
regardless of ledger size:

```sql
CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_company_id uuid, p_as_of date)
RETURNS TABLE(account_code text, account_name text, account_type text,
              sub_type text, balance numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT gl.account_code, coa.name, coa.type, coa.sub_type,
         SUM(CASE WHEN coa.type = 'asset' THEN gl.debit - gl.credit
                  ELSE gl.credit - gl.debit END)
  FROM public.general_ledger gl
  JOIN public.chart_of_accounts coa
    ON coa.code = gl.account_code AND coa.company_id = gl.company_id
  WHERE gl.company_id = p_company_id AND gl.date <= p_as_of
  GROUP BY 1,2,3,4;
$$;
```

`SECURITY INVOKER` keeps RLS in force, so tenant isolation still applies.

### Detect the ceiling (minimum bar)

If a client-side fetch must stay for now, make it fail loudly:

```ts
const PAGE = 1000;
const { data, error } = await client.from('general_ledger')
  .select('account_code, debit, credit')
  .eq('company_id', companyId)
  .range(0, PAGE);              // request one extra row

if ((data?.length ?? 0) > PAGE) {
  throw new Error(
    'Ledger too large to aggregate in the browser — this report needs the ' +
    'server-side aggregate. Refusing to show a partial total.');
}
```

Refusing to render beats rendering a wrong number. A user who sees an error
asks for help; a user who sees a plausible wrong total files it.

### Keyset pagination for lists

For long document lists, prefer keyset over offset — offset degrades as it
grows and can skip rows when data changes between pages:

```ts
.order('date', { ascending: false })
.order('id', { ascending: false })     // stable tiebreak
.lt('date', cursorDate)
.limit(50);
```

For the stock ledger specifically, order by `seq` — never `created_at, id`.
uuid tiebreaks produced real valuation drift.

## Column selection

Select the columns you need. `select('*')` over-fetches, breaks when a wide
column is added later, and hides which fields a screen actually depends on.

It matters most on public-facing paths: the API deliberately uses field
allow-lists so internal fields (`cost_at_sale`, `company_id`) can never leak
into a customer-facing response. Keep new endpoints on that pattern.

## N+1 patterns

The usual shape is a list render that fetches per row. Use an embedded select
so PostgREST joins server-side:

```ts
// N+1 — one query per invoice
const invoices = await client.from('invoices').select('id, contact_id');
for (const inv of invoices) {
  const c = await client.from('contacts').select('name').eq('id', inv.contact_id);
}

// One round trip
const invoices = await client.from('invoices')
  .select('id, invoice_number, total_amount, contacts(id, name, email)')
  .eq('company_id', companyId);
```

The other common shape is a lookup map built per row inside a `.map()`. Build
the map once, outside the loop.

## Indexing

Index because a query needs it, not defensively. Every index costs write
throughput and storage, and duplicates are pure waste.

Reliably worth it here:

- **`company_id` on every tenant table.** RLS predicates evaluate per row, so
  an unindexed tenant column turns every query into a scan.
- **Foreign key columns** used in joins or filters.
- **Composite indexes matching real query shapes**, with the equality column
  first: `(company_id, date DESC)` serves "this company's recent documents".
- **Partial indexes** for a hot subset: `WHERE status = 'confirmed'`,
  `WHERE revoked_at IS NULL`.
- **Unique indexes enforcing a business rule** — the only reliable way to
  prevent duplicates under concurrency.

Before adding one, check it does not already exist in another form:

```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'my_table';
```

Column *order* matters: `(company_id, date)` does not serve a query filtering on
`date` alone.

`CREATE INDEX CONCURRENTLY` avoids locking writes on a populated table, but
cannot run inside a transaction block — so it goes in its own statement, not
bundled into a `DO` block.

## Measuring rather than guessing

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ... ;
```

Read for: `Seq Scan` on a large table where an index was expected; a row-count
estimate far from actual (stale statistics — `ANALYZE my_table`); a nested loop
over many rows; a sort that could be served by an index.

Confirm an index is actually being used after you add it. An index that the
planner ignores is cost with no benefit — and its existence can mislead the next
person into thinking the query is covered.

## Current scale, for calibration

The whole database currently holds about 600 GL rows; the largest tenant has
121. Nothing is slow today, and micro-optimising now would be wasted effort.

The useful conclusion is the opposite of "we have time": the code is being
written *now* in patterns that will silently break later. Getting bounds and
aggregation right while the tables are small costs almost nothing. Retrofitting
after a customer's Balance Sheet has been wrong for a quarter costs trust that
is hard to win back.
