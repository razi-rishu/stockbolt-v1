### StockBolt conventions — concrete patterns

Read when writing a new file or unsure how something is done here. The golden
rule underneath all of it: **open two or three existing files of the same kind
and copy their shape.** These examples are illustrative; the live code is
authoritative and this file will drift before it does.

## The "read the neighbours" checklist for a new file

Before writing a new component/hook/adapter method, answer these by looking at
siblings, not from memory:

1. Where does its kind live? (`src/modules/<domain>/…`, `src/hooks/…`,
   `src/ui/…`, `src/data/…`) Put it beside its peers.
2. How do those peers get data? (Almost always `getAdapter()` + TanStack Query.)
3. Which styling system does that folder use — Tailwind tokens or `theme.ts`?
   Match it; don't mix.
4. How do they handle loading / empty / error states? Mirror the pattern.
5. Where do their user-facing strings come from? (`t('...')` + `en.json`/`ar.json`.)
6. What do their imports look like — grouping, path aliases (`@/…`)? Match it.

## Data access — the adapter, never raw

The app never talks to Supabase from a component. It goes through the adapter so
the self-hosted path stays viable and the data layer stays swappable.

Shape of a new read method (interface in `adapter.ts`, impl in `supabaseAdapter.ts`):

```ts
// adapter.ts — declare the contract
export interface SomethingAPI {
  list(company_id: string): Promise<SomethingRow[]>;
  getById(id: string): Promise<SomethingRow | null>;
}

// supabaseAdapter.ts — implement, always company-scoped, always error-checked
something: {
  async list(company_id): Promise<SomethingRow[]> {
    const { data, error } = await client.from('something')
      .select('col_a, col_b, col_c')          // explicit columns, never *
      .eq('company_id', company_id)            // tenant scope, always
      .order('created_at', { ascending: false });
    assertNoError(error, 'something.list');    // surface, don't swallow
    return data ?? [];
  },
},
```

A component importing the Supabase client directly is wrong for this codebase —
add an adapter method instead. Writes that post to the ledger go through an RPC,
not a raw insert (see `accounting-engine` / `database-guardian`).

## Server state — TanStack Query

```ts
const { data: rows = [], isLoading } = useQuery({
  queryKey: ['something', company_id],
  queryFn: () => getAdapter().something.list(company_id!),
  enabled: !!company_id,
});

const qc = useQueryClient();
const save = useMutation({
  mutationFn: (input) => getAdapter().something.create(input),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['something', company_id] }),
});
```

Local UI state (a modal open flag, a form draft) is `useState`. Don't put server
data in a global store, and don't hand-roll fetching with `useEffect` when a
query fits.

## Styling — match the file's system

**Tailwind (most screens):** use the config tokens, never raw hex.
```tsx
<div className="rounded-xl border border-ink-100 bg-surface-0 shadow-sm">
  <span className="text-ink-500">Label</span>
  <button className="bg-brand-600 hover:bg-brand-700 text-white">Save</button>
</div>
```

**`theme.ts` inline (some reports / shared primitives):**
```tsx
<td style={{ color: theme.inkMuted, fontSize: '13px' }}>…</td>
```

Both are fine; pick the one the file already uses. Do not convert a file between
them as a side effect, and do not add a third approach (styled-components, CSS
modules, inline `<style>`).

## i18n — no raw user-facing strings

```tsx
const { t } = useTranslation();
<label>{t('sales.currency')}</label>          // key exists in en.json AND ar.json
```

Every new user-facing string needs a key in both `en.json` and `ar.json`, and
the layout must survive RTL (logical properties / `text-align: end`, not
hardcoded `left`). Internal developer strings (console warnings, error codes)
stay literal. Known existing gap: the Developer/API settings page is
English-only — a documented exception, not a precedent.

## TypeScript

- Strict types; extend the adapter's existing `*Row` / `*Insert` interfaces
  rather than inventing parallel shapes for the same table.
- The one sanctioned `any`-ish escape is casting into dynamic Supabase RPC calls
  (the adapter's `rpcAny` helper), because generated types don't cover dynamic
  RPC names. It is narrow and commented. Don't generalise it.
- Prefer `type`/`interface` and discriminated unions over loose objects for
  anything with variants (document status, classification).

## Errors

- Adapter calls use the `assertNoError(error, 'context.label')` pattern — a
  clear label makes production failures traceable.
- The app has a top-level `ErrorBoundary`; a thrown render error degrades
  gracefully rather than white-screening.
- Never leak a stack trace, SQL, or secret to the UI or logs (`security-guardian`).
- A bare `catch {}` that hides a failure is a defect — handle it or let it
  propagate to somewhere that will.

## Constants, not magic values

Account codes, tax rates, statuses, permission strings, sale channels — these
are named somewhere already (seeded CoA, `tax_rates`, enum checks, `has_perm`
keys). Find that source rather than inlining `5900`, `0.05`, `'confirmed'`, or
`'sales.write'`. A literal in new code is a signal you haven't found where the
codebase names the concept.

## Imports

- Use the `@/` path alias as the existing files do; match their grouping
  (external, then `@/…`, then relative).
- Remove imports you stop using — a stray import is the easiest dead code to
  leave behind.
- Watch for circular imports when a new file pulls from a barrel that pulls back.

## What "leave it alone" looks like in practice

You're adding a column to a report. The report's data method has an unbounded
`.select()` you know is a latent truncation risk (see `database-guardian`), a
variable named `d`, and a missing empty state.

Right move: add your column, match the file's style, and in your report's
**Follow-ups** line note "report X has an unbounded GL fetch (truncation risk)
and no empty state — worth a separate pass." Do **not** fix the fetch, rename
`d`, and add the empty state in the same diff. The reviewer asked for a column;
give them a column they can review in ten seconds, and let the real issue get
its own scoped, tested change. (If the unbounded fetch is *directly* the bug
you were asked to fix, that's different — then it's in scope.)
