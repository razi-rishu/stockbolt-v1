---
name: coding-standards
description: How to write code that fits the StockBolt codebase — its layering (adapter data layer, presentational UI, posting logic in the DB), its conventions (theme tokens, i18n, TanStack Query, strict TypeScript), and the minimal-change discipline a live financial codebase demands. Use this skill when writing or modifying any StockBolt application code (components, hooks, the adapter, utilities), reviewing a diff for quality, deciding how to structure a new file, or when a change risks drifting from the existing style. Especially useful before a refactor, because the instinct to "clean things up" is often exactly wrong here.
---

# Coding standards — writing code that belongs in StockBolt

The other guardian skills own *correctness* in their domains — `accounting-engine`,
`inventory-engine`, `security-guardian`, `database-guardian`, `api-guardian`,
`test-engine`, and `erp-guardian` for change-control. This skill owns *craft*:
writing application code that reads like the code already here and survives for
years. When craft and correctness seem to conflict, correctness wins — see the
priority note below.

## The instinct to correct first

A capable model already knows the generic virtues: clear names, small functions,
no dead code, no `any`, handle errors, don't duplicate logic. Restating them
adds little. What this skill exists to do is aim that competence at *this*
codebase and, more importantly, to **temper one specific instinct that is
actively harmful here**:

> The urge to improve code you happen to be near.

In most projects, tidying an untidy function you're passing through is a small
virtue. In a **live ERP holding real customers' books**, it is a liability. Every
line you touch is a line that could regress a posting path, and a "clean-up"
diff hides the one real change inside twenty cosmetic ones, making review — and
rollback — far harder. So the single most important standard here is the one the
source draft buried near the bottom:

**Change only what the task requires. Leave everything else exactly as it is,
even if you would have written it differently.** If you spot something genuinely
worth fixing outside your scope, note it for a separate task rather than folding
it in.

## Priority — and why it differs from generic advice

Generic style guides rank readability at the top. Here the ordering is:

1. **Correctness** (data + accounting integrity — see `erp-guardian`)
2. **Consistency** with the surrounding code
3. **Readability / maintainability**
4. **Performance**
5. Micro-optimisation (essentially never)

Readability matters enormously — but never at the cost of a correct number in a
customer's ledger, and never as a reason to restructure working posting logic
into something "cleaner" that you cannot prove is equivalent. Ugly code that
posts the right journal entry beats elegant code you're not certain about. When
in doubt, match what's there.

## Match the codebase — the conventions that actually exist

"Consistent" is meaningless in the abstract. Concretely, code that belongs here
follows these. When unsure of a detail, **read two or three neighbouring files
and copy their shape** rather than trusting a remembered rule — the codebase is
the source of truth, and this list will drift before it does.

- **Data access goes through the adapter, never raw in a component.** The app
  talks to Supabase via `getAdapter()` (`src/data/adapter.ts` interface,
  `supabaseAdapter.ts` implementation, `selfHostedAdapter.ts` stub). A component
  that imports the Supabase client directly is wrong for this codebase — add a
  method to the adapter instead. This keeps the self-hosted path viable and the
  data layer swappable.
- **Server state is TanStack Query; local state is `useState`.** Don't reach for
  a global store for server data — `useQuery`/`useMutation` with sensible
  `queryKey`s and invalidation is the pattern throughout. The app already sets a
  30s `staleTime` default.
- **Styling has two systems, both legitimate — match the file you're in.** Most
  screens use Tailwind against the config's `brand-*` (violet), `ink-*`,
  `surface-*` tokens. A subset (some reports, shared primitives) use the
  `theme.ts` inline-style object. Don't introduce a third approach, and don't
  convert a file from one to the other as a side effect. Never hardcode a hex
  colour where a token exists.
- **User-facing text is i18n, not string literals.** Strings go through
  `useTranslation()` / `t('...')` with keys in `en.json` and `ar.json`, and the
  app is RTL-aware for Arabic. A new hardcoded English string in a customer-facing
  view is a defect. (Known exception already in the tree: the Developer/API
  settings page shipped English-only — that's a documented gap, not a pattern to
  copy.)
- **Errors surface through the established helpers, not raw.** The adapter uses
  an `assertNoError`-style pattern; the app has an `ErrorBoundary`. Handle the
  failure and give the user something real — but never leak a stack trace, SQL,
  or a secret into the UI or logs (see `security-guardian`). "Handle, don't
  swallow" — a silent `catch {}` that hides a posting failure is worse than the
  error.
- **Money, tax rates, account codes, statuses, permission strings are not magic
  values.** They live in constants, seeded data, or the CoA — never inlined. A
  literal `5900` or `'confirmed'` or `0.05` in new code is a smell; find where
  the codebase already names it.

## File size — cohesion, not a line count

The source draft proposes hard limits (<300-line component, <200-line hook).
Treat these as a *smell threshold, not a rule*. `supabaseAdapter.ts` is
thousands of lines by design — it is the single data layer, and splitting it for
the sake of a number would scatter related methods and create import churn for
no benefit. The real question is cohesion: does this file do one job? A
2,000-line adapter that does one job (data access) is fine; a 250-line component
that does four is not. Split when responsibilities diverge, not when a counter
trips.

## TypeScript

Strict typing is the norm and `any` is a last resort — but note the one
sanctioned escape hatch already in the codebase: calls into generated Supabase
RPC types sometimes need a narrow cast (the `rpcAny` helper in the adapter)
because the generated types don't cover dynamic RPC names. That is a contained,
commented exception, not license for `any` elsewhere. Prefer extending the
adapter's existing interfaces over inventing parallel shapes.

## Comments — explain the why, especially the scars

Comment the *why*, never the *what* — the code says what. In this codebase the
highest-value comments explain a **non-obvious constraint born from an
incident**: why stock reads order by `seq` and not `created_at`, why an amount
derives from `total − tax` rather than the header subtotal, why a reversal uses
the voucher date. When you touch code guarded by a comment like that, the
comment is a warning — understand it before changing the line, and preserve it.
Match the surrounding comment density; this codebase comments its posting logic
heavily and its plumbing lightly.

## Before adding a dependency

New libraries are rarely the answer here. The stack is deliberately lean, and
`xlsx` already demonstrates the cost of a heavy dependency (an unfixable
security advisory on a package that parses user uploads — see `security-guardian`).
Before adding one: is it genuinely needed, actively maintained, acceptably
sized, license-clean, and free of known CVEs? Usually the codebase already has a
utility that does most of what you want.

## Verifying and reporting

Match the effort to the change (full tiering in `erp-guardian`): `tsc --noEmit`
and a build for anything; drive the UI for visible changes; the regression suite
and numeric checks for anything touching data or money.

For a non-trivial change, close with:

```
Files modified   — paths
What changed     — plainly, and confirm it stayed within task scope
Conventions      — which existing patterns you matched (adapter / tokens / i18n / query)
Trade-offs       — anything you chose not to do, and why
Follow-ups       — out-of-scope things you noticed but deliberately left alone
Confidence       — high / medium / low, and what would raise it
```

The "follow-ups" line is where the tidy-up urge goes to be useful without being
dangerous: name the thing, don't fix it inline.

## When to stop and ask

- A "clean refactor" would touch working posting, costing, or reporting code you
  can't prove equivalent — don't; propose it as a separate, reviewable task.
- A change would introduce a third styling system, bypass the adapter, or add a
  hardcoded user-facing string.
- You're tempted to reach for `any`, a new global store, or a new dependency —
  check whether the codebase already has the pattern first.
- Splitting a large file would scatter cohesive logic just to satisfy a line
  count.

## References

- **`references/conventions.md`** — concrete file-by-file examples of each
  convention (adapter method shape, query/mutation pattern, token usage, i18n
  key structure), and the "read the neighbours" checklist for a new file. Read
  when writing a new file or unsure how something is done here.
