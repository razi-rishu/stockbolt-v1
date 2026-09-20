### React performance — the app-side traps

Read when a screen feels slow. Measure before changing anything: React DevTools
Profiler (or the browser Performance panel) tells you *what* re-rendered and how
long it took. A guess at the cause is usually wrong; the profiler is usually
right in one recording.

Remember the scale context (SKILL.md): at current data volumes almost nothing
here is actually slow. Most "optimization" on this codebase is unnecessary and
adds risk. Fix a measured jank, not a theoretical one.

## What actually causes slow renders

**A big list re-rendering on every keystroke.** A search box whose state lives
in a parent that also renders the list means each character re-renders every
row. Fixes, cheapest first: move the input's state local to the input; debounce
the value that reaches the list; only virtualize (below) if the list is
genuinely long.

**Expensive work in render.** A sort, filter, or reduce over a large array
recomputed every render. Wrap it in `useMemo` keyed on its real inputs — but
only if it's measurably expensive. `useMemo` on a cheap expression costs more
(in memory and complexity) than it saves.

**New references defeating memoization.** A `{}` / `[]` / arrow function created
inline and passed as a prop is a new reference each render, so a `React.memo`
child re-renders anyway. Stabilise with `useMemo`/`useCallback` *when the child
is memoized and the prop identity is why it re-renders* — not reflexively on
every callback, which just adds noise.

**`useEffect` over-firing.** An effect with a missing or unstable dependency
that runs every render, often refetching. Check the dependency array; stabilise
the dependencies rather than removing them.

**Unkeyed or poorly-keyed lists.** Using array index as `key` on a reorderable
list makes React re-render/remount rows unnecessarily. Use a stable id.

## When memoization helps — and when it's cargo-cult

`useMemo`/`useCallback`/`React.memo` are tools for a *specific* measured problem
(an expensive computation, or a memoized child re-rendering from prop identity).
Applied everywhere by reflex they make code harder to read for no measurable
gain, and can even slow things slightly. The rule: reach for them when the
profiler shows the cost, not to pre-empt a cost you haven't seen. This matches
`coding-standards` — don't add complexity the task doesn't need.

## TanStack Query — the app's server-state cache

The app already uses TanStack Query with a 30s `staleTime` and `retry: 1`. That
means most navigations serve cached data and don't refetch — good, and usually
enough. Before "optimizing" a fetch, check whether the perceived slowness is a
genuine query or just a missing loading state making a fast query feel slow.

- Reuse `queryKey`s so screens share cache instead of each refetching.
- Invalidate precisely after a mutation (`invalidateQueries` on the affected
  key) rather than refetching everything.
- Don't hand-roll fetching in `useEffect` when a query fits — you lose the cache
  and dedup that make the app feel fast.

## List virtualization — only when truly long

Rendering thousands of DOM rows is slow. Virtualization (render only the visible
window) fixes it — but the codebase currently has **no** virtualization library,
and at present data volumes it doesn't need one. Introduce it only for a list
that is genuinely long in real customer data (the stock ledger or GL for a busy
tenant), and treat adding the dependency as a real decision. Most lists here are
short enough that virtualization would be complexity for no gain.

## Measuring a render

1. React DevTools → Profiler → record → interact → stop.
2. Read the flame chart: which component rendered, how many times, how long.
3. Find the *cause* (state that changed, prop identity, effect) — don't just
   memoize the symptom.
4. Make the one change, re-record, confirm the render count/time dropped.
5. Confirm behaviour is unchanged — a faster component that renders stale or
   wrong data is not a win, and on a financial screen that's a real hazard.

## What not to do

- Don't scatter `useMemo`/`useCallback` "to be safe" — measure first.
- Don't lift state up and then fight the re-renders that causes; keep state as
  local as it can be.
- Don't cache derived financial values in component state to avoid recompute —
  derive them each render from the query data, so they can't go stale
  (`accounting-engine`: no cached aggregates).
- Don't add a virtualization/perf library for a list that isn't actually long.
