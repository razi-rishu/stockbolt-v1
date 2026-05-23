/**
 * Module-adapter interface — Phase 14.11.
 *
 * Each importable / exportable module (products, contacts, COA, tax rates,
 * units, brands, categories, salespeople, warehouses, price-levels)
 * implements this small contract. The wizard uses the contract uniformly
 * so the UI doesn't need to know module specifics.
 *
 * Contract:
 *   headers        Column order for export + template + import. Must match
 *                  exactly when the operator brings their own file back.
 *   template       Example rows the operator can fill in. 1-3 rows is
 *                  ideal — enough to show shape, not so many they get
 *                  pasted into production.
 *   serialize      DB row → CSV-friendly row (flatten relationships,
 *                  format dates as YYYY-MM-DD, decimals as strings).
 *   validate       One parsed row → either a typed DB-shaped row OR an
 *                  array of human-readable errors. No DB writes here.
 *   apply          The whole validated set → run the inserts/updates.
 *                  Returns counts so the wizard can show a summary.
 *
 * Naming convention: module key matches the data-adapter API key
 * ('products' → getAdapter().products) so picking modules from a record
 * stays consistent.
 */

import type { RawRow } from '../_io';

export type DuplicatePolicy = 'skip' | 'update' | 'error';

export interface ValidationOk<T> {
  ok: true;
  row: T;
}
export interface ValidationFail {
  ok: false;
  errors: string[];
}
export type ValidationResult<T> = ValidationOk<T> | ValidationFail;

export interface ApplyResult {
  inserted: number;
  updated:  number;
  skipped:  number;
  errors:   Array<{ rowIndex: number; message: string }>;
}

export interface ModuleAdapter<DBRow, ValidatedRow = DBRow> {
  /** Stable key — matches the URL hash and the data-adapter key. */
  key:       string;
  /** Human label shown in the module picker. */
  label:     string;
  /** One-line description shown below the label. */
  description: string;
  /** Lucide-style icon character (just an emoji for now). */
  icon:      string;

  headers:   string[];
  template:  () => Record<string, string>[];

  /** Pull existing rows from the DB for export. */
  fetchAll:  (company_id: string) => Promise<DBRow[]>;
  /** DB row → flat string-typed row for the file. */
  serialize: (row: DBRow) => Record<string, string>;

  /** Per-row validation. Receives the parsed RawRow + any pre-loaded
   *  lookup tables the adapter needs (e.g. existing tax rates for the
   *  product import to resolve "5%" → tax_rate_id). */
  validate: (
    raw:     RawRow,
    context: ImportContext,
  ) => ValidationResult<ValidatedRow>;

  /** Persist the validated rows. Handles dedup policy + reports counts. */
  apply: (
    rows:    ValidatedRow[],
    context: ImportContext,
    policy:  DuplicatePolicy,
  ) => Promise<ApplyResult>;
}

/** Shared context passed to validate() + apply(). Pre-loaded lookup
 *  tables here so each adapter doesn't re-fetch per row. */
export interface ImportContext {
  company_id: string;
  /** Existing rows of THIS module, indexed by natural key (e.g. SKU
   *  for products, code for COA). Used for duplicate detection. */
  existing: Map<string, { id: string }>;
  /** Module-specific lookups; adapters cast to their shape. */
  lookups: Record<string, unknown>;
}
