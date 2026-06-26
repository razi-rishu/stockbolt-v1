# Document 8 — Integrated Automotive Catalog — Architecture & Migration Plan

> Status: **DESIGN — not yet built.** TecDoc-grade redesign of Vehicle Master, Brands, Categories,
> Parts Catalog and Product Compatibility on a **live** multi-tenant ERP. Built in approved
> milestones (C1–C8). No code ships from this doc alone. Last updated: 2026-06-25.

---

## 0. Principles (non-negotiable)
1. **Vehicle Master = single source of truth.** Parts Catalog, Inventory and Compatibility all read
   from it. No hardcoded dropdowns — everything DB-driven.
2. **No duplicate data.** We **evolve** existing tables (`categories` is already hierarchical;
   `product_compatibility` m2m already exists) rather than create parallels.
3. **Existing customers must not break.** Every step is **additive** (new tables + nullable columns);
   nothing existing is dropped or renamed. Legacy 2-level vehicles + current compatibility keep
   working while the deeper hierarchy is layered on top.
4. **Future-ready by schema, not rewrite.** Every catalog table carries `external_source` +
   `external_ref` from day one, so VIN / TecDoc / OEM / eBay imports map in later with zero schema
   change.
5. **Migrations run by hand** (Supabase SQL Editor), staged, each verifiable.

## 1. Current state (what we build on)
| Table | Today | Gap |
|---|---|---|
| `vehicle_makes` | id, company_id **(nullable = system-shared)**, name, logo_url | + country, is_active, external_* |
| `vehicle_models` | id, make_id, name, chassis_code | only 2 levels — needs gen/variant below |
| `categories` | id, company_id, **parent_id**, name(_ar), sort_order, is_active | **already nested** — + icon, image, description |
| `brands` | id, company_id, name(_ar), logo_url, is_active | + country, manufacturer, website, description |
| `product_compatibility` | m2m product ↔ vehicle_model | extend to generation/variant-level fitment |
| `products` | brand_id, category_id, oe_number, replacement_numbers[] | reused as-is |

---

## 2. New / evolved data model (§9)

### 2.1 Vehicle hierarchy (Make → Model → Generation → Variant → Engine)
```
vehicle_makes ─┬─ vehicle_models ─┬─ vehicle_generations ─┬─ vehicle_variants ──→ vehicle_engines
 (existing)     │  (existing)      │  (NEW)                │  (NEW: leaf/fitment)   (NEW: reusable)
```
- **`vehicle_makes`** *(evolve)* — add `country TEXT`, `is_active BOOLEAN DEFAULT true`, `external_source TEXT`, `external_ref TEXT`.
- **`vehicle_models`** *(evolve)* — add `body_type TEXT`, `is_active`, `external_*`. Keep `chassis_code` for back-compat.
- **`vehicle_generations`** *(NEW)* — `id, model_id FK, name (e.g. "E170"), code, year_from INT, year_to INT, is_active, external_*`.
- **`vehicle_engines`** *(NEW)* — reusable engine catalog: `id, company_id (nullable=system), engine_code, displacement_cc INT, fuel_type, power_hp INT, description, external_*`.
- **`vehicle_variants`** *(NEW — the leaf/fitment node)* — `id, generation_id FK, engine_id FK→vehicle_engines, transmission TEXT, drive_type TEXT, year_from INT, year_to INT, chassis_code TEXT, label TEXT, is_active, external_*`.
  - A variant = one precise fitment ("Corolla E170 · 1.8L Petrol · Automatic · FWD · 2017").

RLS: tenant rows (`company_id = current_user_company_id()`) **OR** `company_id IS NULL` (system-shared catalog, read-only to tenants). Writes gated by `inventory.write`. FKs `ON DELETE CASCADE` down the tree; indexes on every FK + `(make_id)`, `(model_id)`, `(generation_id)`, year columns.

### 2.2 Compatibility (§4) — evolve `product_compatibility` (no duplicate table)
Add nullable `generation_id` + `variant_id` (keep `vehicle_model_id`). A row may fit at model, gen,
or variant precision. Unlimited rows per product (true m2m). Existing rows stay model-level and keep
working. (The spec's `inventory_vehicle_links` = this evolved table; we don't create a parallel.)

### 2.3 Brands (§5) — evolve `brands`
Add `country TEXT`, `manufacturer TEXT`, `website TEXT`, `description TEXT`, `external_*`. `logo_url`,
`is_active`, timestamps already exist. **Merge**: a `merge_brands(keep_id, dup_id)` DEFINER RPC
re-points `products.brand_id` then deletes the duplicate (audited).

### 2.4 Categories (§6) — evolve `categories` (already nested)
Add `icon TEXT`, `image_url TEXT`, `description TEXT`, `description_ar TEXT`, `external_*`.
`parent_id`/`sort_order`/`is_active` already exist → the tree + drag-drop ordering is UI work, not schema.

---

## 3. Data migration (the risky part — §"migration scripts")
**C1 migration is fully additive and safe:**
1. `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` for the brand/category/make/model enrichment + the
   `external_*` columns everywhere (all nullable / defaulted) — zero impact on existing rows.
2. `CREATE TABLE IF NOT EXISTS` the three new tables (generations, variants, engines) + RLS + indexes.
3. `ALTER TABLE product_compatibility ADD COLUMN generation_id …, variant_id …` (nullable).
4. **Backfill for continuity:** for every existing `vehicle_model`, optionally create one
   `vehicle_generation` ("Default") + one `vehicle_variant` carrying the model's `chassis_code`, so
   legacy data immediately appears in the new cascading filters. Existing `product_compatibility`
   rows are left at model-level (still valid).
5. No drops, no renames, no FK changes on existing columns → **existing Parts Catalog / inventory /
   product editor keep working unchanged** during and after the migration.

Rollback = drop the 3 new tables + the added columns (they hold only new catalog data, never
financial/transactional data).

---

## 4. UIs

### 4.1 Vehicle Master — master-detail (§2)
`/products/vehicles` rebuilt: **left** = searchable Makes list; **right** = selected make with tabs
**Models · Generations · Engine Variants · Import · Statistics**. Drill: Make → Models → click model →
Generations → click generation → Variants/Engines. Everything inline-editable, split-pane, paginated,
keyboard-navigable, bulk edit/delete.

### 4.2 Parts Catalog — cascading filters (§3)
Make → Model → Generation → Engine → Year → Fuel → Transmission, each populated from the level above
(only combinations that exist in `vehicle_variants`). Result = products whose `product_compatibility`
matches the chosen variant (or its generation/model). No free-typing.

### 4.3 Product editor — compatibility manager (§4)
A "Fits vehicles" section: add unlimited (make→model→generation→variant) rows → `product_compatibility`.

### 4.4 Brands & Categories management (§5, §6)
Brands: enriched form + logo upload + search + import/export + **merge duplicates**. Categories:
nested tree with drag-drop ordering, icon/image, import/export.

## 5. Import (§7) + Search (§8)
- **Vehicle import** (CSV/Excel) columns: Make, Model, Generation, Year From, Year To, Engine, Fuel,
  Transmission, Drive, Engine Code, Chassis — upserted by natural key to **avoid duplicates** (reuses
  the existing Phase-14.11 import/export framework).
- **Global search** extended to makes, models, generations, brands, categories, engine codes, chassis
  codes, OE numbers, part numbers (the existing `search_products` RPC + `replacement_numbers[]`).

## 6. Future-ready (§11)
The `external_source` + `external_ref` columns on every catalog table are the integration seam:
- **VIN lookup** → a later `vin_patterns(wmi, vds, make_id, model_id, generation_id)` table maps a VIN
  to a vehicle; no change to the core hierarchy.
- **TecDoc / OEM / eBay** imports populate `external_source='tecdoc'` + `external_ref=<their id>` and
  reuse the variant/engine model directly.

---

## 7. Milestones (build order)
| C | Scope | Risk |
|---|---|---|
| **C1** | Schema migration: new tables + enrichment columns + compatibility evolve + backfill (by hand) | low (additive) |
| **C2** | Adapter types/APIs for the new hierarchy + compatibility | low |
| **C3** | Vehicle Master master-detail UI (makes/models/generations/variants/engines CRUD) | med |
| **C4** | Product editor compatibility manager (variant-level m2m) | med |
| **C5** | Parts Catalog cascading filters | med |
| **C6** | Brands enrichment + merge + import/export | low |
| **C7** | Categories tree (drag-drop) + icon/image + import/export | med |
| **C8** | Vehicle import (CSV/Excel) + global-search extension; VIN/TecDoc seams verified | med |

Each milestone: migration (if any, run by hand) + adapter/UI + `tsc`/regression green, committed, pushed.

## 8. Backward-compatibility & risk
- **Additive only** — no existing column/table dropped; legacy 2-level vehicles + current
  compatibility keep functioning throughout. Existing products' `brand_id`/`category_id` untouched.
- **System-shared makes** (`company_id IS NULL`) preserved; new system catalog can be seeded without
  touching tenant data.
- **No financial impact** — catalog is master data; nothing here touches GL/stock/posting.
- Main risk is a mis-mapped backfill → mitigated by making backfill optional/idempotent and verifying
  per-tenant counts before/after.

## 9. Testing
Create a make → model → generation → variant → engine chain · cascading filter shows only valid
combinations · product fits multiple variants (m2m) · brand merge re-points products + deletes dup ·
category nesting + reorder persists · vehicle import upserts without duplicates · global search finds
make/model/brand/category/OE/part · **RLS: a tenant sees only its own + system rows, never another
tenant's** · existing products/compatibility unaffected after C1.

## 10. Open decisions (for you)
1. **Engine modelling:** separate reusable `vehicle_engines` table (recommended, TecDoc-like) vs engine
   attributes inline on `vehicle_variants` (simpler). Plan assumes the former.
2. **Backfill legacy models** into a Default generation/variant on C1 (recommended for continuity) vs
   leave models bare until re-entered.
3. **System vs per-tenant catalog:** seed a shared GCC/India make+model catalog (`company_id NULL`)
   that all tenants inherit, vs each tenant builds its own. Recommended: seed a shared base, tenants
   extend.
