# StockBolt — AC-4: E-invoicing Foundation (region-phased) — Specification

**Created:** 2026-07-24 · Analysis + spec only, no implementation. Region-agnostic foundation for **UAE (Peppol/PINT)** + **India (GST IRP/IRN)**. No posting-logic change.

> **Regulatory caveat (read first).** Knowledge cutoff Jan 2026. E-invoicing schemas, thresholds, and mandate dates change and are jurisdiction-authoritative. This spec designs the **integration shape**, not the exact byte-level schema. The **provider's sandbox + the official FTA/GSTN specification are the source of truth** and must be confirmed at implementation time. Nothing here should be treated as a settled legal fact.

Convention: **[REUSE]** existing · **[NEW]** net-new · **[DEFER]** later track, flagged.

---

## 0. Current state
- **No e-invoicing today.** Invoices print via the Signature template system (phase15); nothing generates a government e-invoice, no clearance, no IRN/QR.
- **To build on:** `invoices` (subtotal, tax_amount, total, discount, contact, items with line tax) · `companies` (country_code, `tax_id` = TRN/GSTIN, is_tax_registered) · `contacts` (`tax_id`, region_id) · the **public-API Edge Function** `supabase/functions/api/index.ts` (server-side, holds secrets — the right place for provider calls) · AC-3's `tax_rates` + jurisdiction mapping.
- **Gap that matters:** the invoice model captures money + a tax rate, but **not** the classification an e-invoice legally needs — HSN/SAC codes (India), place-of-supply state, buyer registration/scheme, tax-treatment (zero/exempt/RCM/export). **This is the same metadata AC-3 full-fidelity needs** — a shared prerequisite (§4).

## 1. What e-invoicing means per region (design level)
- **India (GST) — IRP clearance model.** Generate a JSON in the GST e-invoice schema → POST to the Invoice Registration Portal (directly or via a **GSP**) → receive an **IRN + government-signed QR + acknowledgement** → print IRN/QR on the invoice; it also feeds GSTR-1 / e-way bill. Mature + mandatory above a turnover threshold. **Needs:** GSP/API credentials; per-invoice: line **HSN/SAC**, buyer **GSTIN**, **place-of-supply** state, tax split.
- **UAE (VAT) — Peppol 5-corner (DCTCE) model.** Generate a **PINT AE** (Peppol) UBL/XML document → transmit over the **Peppol network via an Accredited Service Provider (ASP / Access Point)** → report to the FTA. Phased mandate. **Needs:** an ASP account; the Peppol party identifiers + PINT-AE UBL mapping.
- **Common shape (why a region-agnostic core works):** *StockBolt invoice → canonical model → region format (JSON/UBL) → submit via provider → identifier + status → store + print.* Only the **mapper** and **transport** differ by region; the lifecycle, storage, status UI, and audit are shared.

## 2. Architecture — region-agnostic foundation [NEW, mostly presentation/data + a server hook]
1. **Canonical e-invoice model** [NEW, pure] — a normalized TypeScript type (seller, buyer, party IDs, lines w/ HSN + tax treatment, tax breakdown, totals, currency, doc references) built from a posted StockBolt invoice. Pure mapping; **no tax recompute** (reuses posted `tax_amount`).
2. **Region formatters** [NEW, pure] — `toIndiaGstJson(canonical)` and `toPintAeUbl(canonical)`. Pure functions, unit-testable, producing the region payload. (Schema-valid output depends on §4 metadata.)
3. **Provider interface** [NEW] — `generate() · submit() · cancel() · status()`. Two implementations:
   - **Manual/offline provider** (default, v1): generates the compliant file for the user to **download and upload to the portal**, and lets them **paste back the IRN/QR/ack**. Delivers value with **no paid integration**.
   - **Live provider** (GSP / ASP) [DEFER]: real clearance in the **Edge Function** (holds credentials, does signing/transport). Needs a provider account + sandbox.
4. **Lifecycle + storage** [NEW] — an `e_invoice_documents` register (one per invoice) with status **pending → generated → submitted → cleared / rejected / cancelled**, the payloads, the returned IRN/QR/ack, provider, error, and audit.
5. **UI** [NEW] — an e-invoice **status panel** on the invoice (badge + IRN/QR + generate/download/submit/record actions), gated by permission; reuses the invoice editor shell + `<DocLink>`/print.

## 3. Schema — minimal, additive, hand-applied
- **`e_invoice_documents`** [NEW table]: id, company_id, invoice_id (FK), jurisdiction ('AE_VAT'|'IN_GST'), format ('PINT_AE'|'IN_GST_JSON'), status CHECK(pending/generated/submitted/cleared/rejected/cancelled/failed), canonical jsonb, payload jsonb (region doc), provider text, external_id text (IRN / Peppol msg id), ack_number, signed_qr text, response jsonb, error text, audit (created/submitted/cleared by+at). UNIQUE(invoice_id) (one active e-invoice per invoice; cancel+regenerate cycles status). RLS read-only; writes via SECURITY DEFINER RPCs. **No change to any posting RPC** — e-invoicing observes posted invoices, never alters GL.
- **The §4 metadata** (below) is the larger, shared schema question.

## 4. The metadata prerequisite (shared with AC-3 full-fidelity)
A schema-valid e-invoice **cannot** be produced from today's data. It needs, captured at document entry:
- **Products:** HSN/SAC code (India), and a unit-of-measure code mapping.
- **Contacts:** buyer GSTIN/TRN (have `tax_id`), place-of-supply **state code** (India), buyer type (registered/unregistered/export/SEZ).
- **Invoice/line:** tax **treatment** (standard / zero / exempt / RCM / export / import), export flag + shipping/port details.
This is a **document-model + entry-UI change** (a few columns + form fields + validation), touching masters and the invoice editor — **not** posting logic. It is the honest long-pole of AC-4, and it **also unblocks AC-3 full-fidelity** (VAT201/GSTR box-splitting). Recommend building it **once**, shared.

## 5. Scope tiering (the key call)
- **AC-4 FOUNDATION (recommended first):** the §4 metadata capture · the canonical model + **one** region formatter · the `e_invoice_documents` lifecycle + status UI · the **manual/offline provider** (generate compliant file, record IRN/QR back) · export/print of IRN/QR. Delivers compliant e-invoice **generation + tracking** with **no paid provider, no posting change** — and lays the shared metadata AC-3 full-fidelity reuses.
- **AC-4 LIVE INTEGRATION (deferred track):** real IRP/ASP clearance in the Edge Function + webhooks + auto-GSTR-1/e-way-bill. Needs a chosen **provider account + sandbox credentials** (a commercial decision + cost), and per-region certification. Its own phase.

## 6. Reuse & integrity
- Reuses posted invoice + tax data (no recompute), the Edge Function (server calls), the print system (IRN/QR on the document), permissions, i18n. **No posting/GL change** — e-invoicing is an observer of confirmed invoices. Generating/submitting an e-invoice never edits the ledger; a rejected clearance is a status, not a reversal.

## 7. Regression & rollback
- **Regression:** unit tests on the pure canonical mapper + region formatters (golden-file fixtures per region); structural tripwires (soft-until-applied) on `e_invoice_documents` + RPCs; a read-only invariant that every 'cleared' e-invoice has an external_id + belongs to a confirmed invoice. Behavioural (generate→record→cancel) in the staging-gated suite. Live-clearance tests run only against the provider sandbox (never prod).
- **Rollback:** additive — drop `e_invoice_documents` + RPCs + the metadata columns; remove the UI/mapper/formatters. No GL/posting to undo.

## Locked decisions (confirmed 2026-07-24)
1. **Region:** build **both foundations now** — the region-agnostic core + **India (GST IRP/IRN) and UAE (Peppol PINT-AE)** mappers together.
2. **Integration:** **foundation + manual/offline provider** — generate the compliant file for portal upload + record IRN/QR/ack back. **Live GSP/ASP clearance is a deferred track** (needs a paid provider account + sandbox).
3. **Metadata:** build the §4 document-classification metadata **once, shared with AC-3 full-fidelity** (HSN/SAC, place-of-supply state, buyer type, tax treatment).
4. **Documents:** **sales invoices only** in v1 (credit/debit e-notes deferred).

## Suggested increments (on approval — each: analysis/spec → implement → verify → stop for review)
- **AC-4A** — the **shared metadata** migration (product HSN/SAC + UoM code; contact place-of-supply state + buyer type; invoice-line tax treatment) + adapter types + entry-UI fields + validation + unit tests. No clearance. *(Also unblocks AC-3 full-fidelity.)*
- **AC-4B** — the **canonical e-invoice model** + **both** pure region formatters (`toIndiaGstJson`, `toPintAeUbl`) + golden-fixture unit tests. No DB, no UI. (Formatters validated structurally; byte-level schema confirmed against the official spec/sandbox at this step.)
- **AC-4C** — `e_invoice_documents` migration + manual-provider lifecycle RPCs (generate / record-IRN / cancel) + adapter methods + structural tripwires. No posting change.
- **AC-4D** — the e-invoice **status panel** on the invoice (generate → download file → record IRN/QR back → status badge, permission-gated) + i18n.
- **AC-4E** — regression (structural + read-only invariants + staging-gated behavioural generate→record→cancel).
- **(Deferred)** live GSP/ASP clearance in the Edge Function — separate, once a provider account exists.

_Awaiting your go-ahead to start **AC-4A** (spec-first, per the usual workflow). Given the regulatory caveat, AC-4B will need the official India GST + UAE PINT-AE schema references confirmed at that step._
