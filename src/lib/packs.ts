/**
 * Packs (phase155): a product keeps one base unit; a pack is a named value of
 * it (BOX = 12 PCS, "200 g" = 0.2 KG). The database does the real work — it
 * fills base quantities and refuses what is wrong. These are the same rules in
 * the screen, so a user is told BEFORE a save starts: saving replaces a
 * draft's lines, and a refusal half way would leave it without any.
 *
 * Pure functions only. With packs off nothing here is used.
 */
export interface ProductUnitRow {
  id: string;
  company_id: string;
  product_id: string;
  name: string;
  name_ar: string | null;
  unit_id: string | null;
  /** Base units in one pack. */
  factor: number;
  selling_price: number | null;
  purchase_price: number | null;
  barcode: string | null;
  for_sales: boolean;
  for_purchases: boolean;
  is_active: boolean;
  sort_order: number;
}

/** What a saved document line knows about its pack (phase155 columns). */
export interface PackLineFields {
  product_unit_id?: string | null;
  unit_factor?: number | null;
  base_quantity?: number | null;
  unit_label?: string | null;
}

/** Counted in whole units unless the unit says otherwise (same list as the database). */
const WHOLE_UNITS = new Set([
  'PCS', 'PC', 'PCE', 'PIECE', 'PIECES', 'NOS', 'NO', 'EA', 'EACH', 'UNIT', 'UNITS', 'SET', 'SETS', 'PAIR', 'PR',
  'BOX', 'BOXES', 'BX', 'PKT', 'PACK', 'PK', 'CTN', 'CARTON', 'DOZ', 'DZN', 'DOZEN', 'BAG', 'BTL', 'DRUM', 'ROLL',
]);

/** A product without a unit counts as PCS. */
export function unitAllowsDecimals(unit: { code: string; allows_decimals?: boolean | null } | null | undefined): boolean {
  if (!unit) return false;
  return unit.allows_decimals ?? !WHOLE_UNITS.has(unit.code.trim().toUpperCase());
}

/** Stock is counted to three decimals; factors have six. Works in integers. */
export function baseQuantity(quantity: number, factor: number): number {
  return Math.round(quantity * 1000) * Math.round(factor * 1e6) / 1e9;
}

export type PackProblem = 'too_small' | 'whole_units';

/** What the database would refuse, or null. `factor` 1 = the base unit. */
export function packProblem(quantity: number, factor: number, allowsDecimals: boolean): PackProblem | null {
  const base = baseQuantity(quantity, factor);
  const thousandths = base * 1000;
  if (Math.abs(thousandths - Math.round(thousandths)) > 1e-6) return 'too_small';
  if (!allowsDecimals && Math.abs(base - Math.round(base)) > 1e-9) return 'whole_units';
  return null;
}

/** 24 → "24", 0.5 → "0.5", 1200 → "1,200". */
export function fmtQty(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** BOX → "BOX", "200 g" → "× 200 g", so 3 of them never read as "3 200 g". */
export function packLabel(name: string): string {
  return /^\d/.test(name) ? `× ${name}` : name;
}

/** The price to start from when a pack is picked: its own, else pieces × value. */
export function packPrice(pack: ProductUnitRow, basePrice: number): number {
  return pack.selling_price ?? Math.round(basePrice * pack.factor * 100) / 100;
}

export interface PackLineInput {
  product_id: string;
  /** SKU or name, as the user knows the product. */
  label: string;
  quantity: number;
  factor: number;
  /** BOX; null = sold in the base unit. */
  pack_name: string | null;
  /** PCS, KG…; empty when the product has no unit. */
  base_unit: string;
  allows_decimals: boolean;
  /** After discount, per pack. Null = no price check (credit notes). */
  net_price: number | null;
  /** The product's own price for one base unit. */
  base_price: number;
  /** Average cost of one base unit; 0 = unknown. */
  base_cost: number;
  /** On hand in base units; null = do not check (services, nothing leaves). */
  on_hand: number | null;
  /** Buying: net_price is a cost, compared with the average cost. */
  buying?: boolean;
  /** Counted as packs and loose units: 7 BOX + 7 PCS. */
  loose?: number;
}

export interface PackCheckLine {
  text_qty: string;
  pack_name: string;
  text_base: string;
  label: string;
  base_unit: string;
}
export type PackWarning =
  | { kind: 'price_is_base'; label: string; pack_name: string; base_unit: string }
  | { kind: 'cost_odd'; label: string; base_unit: string; cost: number; usual: number }
  | { kind: 'below_cost'; label: string; pack_name: string; price: number; cost: number }
  | { kind: 'negative'; label: string; have: string; need: string; base_unit: string };
export interface PackCheck {
  /** Every pack line of the document, for the user to accept. */
  lines: PackCheckLine[];
  warnings: PackWarning[];
  /** Must be corrected first: the database would refuse the document. */
  problems: { kind: PackProblem; label: string; text: string; base_unit: string }[];
}

export function checkPacks(input: PackLineInput[]): PackCheck {
  const out: PackCheck = { lines: [], warnings: [], problems: [] };
  const need = new Map<string, number>();
  for (const l of input) {
    const base = baseQuantity(l.quantity, l.factor) + (l.loose ?? 0);
    need.set(l.product_id, (need.get(l.product_id) ?? 0) + base);
    const problem = packProblem(l.quantity, l.factor, l.allows_decimals) ?? (l.loose ? packProblem(l.loose, 1, l.allows_decimals) : null);
    if (problem) {
      out.problems.push({ kind: problem, label: l.label, base_unit: l.base_unit,
        text: l.pack_name ? `${fmtQty(l.quantity)} × ${l.pack_name}` : fmtQty(l.quantity) });
      continue;
    }
    if (!l.pack_name) continue;
    out.lines.push({ text_qty: fmtQty(l.quantity), pack_name: l.loose ? `${l.pack_name} + ${fmtQty(l.loose)} ${l.base_unit || 'PCS'}` : l.pack_name, text_base: fmtQty(base), label: l.label, base_unit: l.base_unit });
    if (l.net_price !== null && l.buying) {
      // A box at the cost of one piece (or a piece at the cost of a box).
      const each = l.net_price / l.factor;
      if (l.factor !== 1 && l.base_cost > 0 && l.net_price > 0 && (each > l.base_cost * 2 || each < l.base_cost / 2)) {
        out.warnings.push({ kind: 'cost_odd', label: l.label, base_unit: l.base_unit, cost: each, usual: l.base_cost });
      }
    } else if (l.net_price !== null) {
      // A box at the price of one piece: the usual slip.
      if (l.factor !== 1 && l.base_price > 0 && Math.abs(l.net_price - l.base_price) < 0.005) {
        out.warnings.push({ kind: 'price_is_base', label: l.label, pack_name: l.pack_name, base_unit: l.base_unit });
      } else if (l.base_cost > 0 && l.net_price < l.base_cost * l.factor - 0.005) {
        out.warnings.push({ kind: 'below_cost', label: l.label, pack_name: l.pack_name, price: l.net_price, cost: l.base_cost * l.factor });
      }
    }
  }
  // Only products that are in a pack on this document: the rest works as before.
  const packed = new Set(input.filter((l) => l.pack_name).map((l) => l.product_id));
  for (const id of packed) {
    const first = input.find((l) => l.product_id === id)!;
    const n = need.get(id)!;
    if (first.on_hand !== null && n > first.on_hand + 1e-9) {
      out.warnings.push({ kind: 'negative', label: first.label, have: fmtQty(first.on_hand), need: fmtQty(n), base_unit: first.base_unit });
    }
  }
  return out;
}

/** What a screen's line carries: the pack picked, and the saved value of one
 *  that is no longer offered. */
export interface LinePack {
  product_unit_id: string | null;
  unit_factor: number | null;
  unit_label: string | null;
}
export const NO_PACK: LinePack = { product_unit_id: null, unit_factor: null, unit_label: null };

export function linePackOf(saved: PackLineFields | null | undefined): LinePack {
  return saved?.product_unit_id
    ? { product_unit_id: saved.product_unit_id, unit_factor: saved.unit_factor != null ? Number(saved.unit_factor) : null, unit_label: saved.unit_label ?? null }
    : NO_PACK;
}
export function linePackFrom(pack: ProductUnitRow | null): LinePack {
  return pack ? { product_unit_id: pack.id, unit_factor: Number(pack.factor), unit_label: pack.name } : NO_PACK;
}
/** Base units in one of the line's unit. */
export function lineFactor(l: LinePack): number {
  return l.product_unit_id ? l.unit_factor ?? 1 : 1;
}
/** The column to write — left out entirely for a line without a pack, so a
 *  company that does not use packs sends exactly what it always did. */
export function packColumn(l: LinePack): { product_unit_id?: string } {
  return l.product_unit_id ? { product_unit_id: l.product_unit_id } : {};
}

export function packInput(
  l: LinePack & { quantity: number; net_price: number | null; buying?: boolean },
  product: { id: string; sku: string; name: string; type?: string | null; unit_id: string | null; selling_price?: number | null } | undefined,
  facts: { unitCode: (id: string | null) => string; allowsDecimals: (id: string | null) => boolean },
  stock: { qty: number; mac: number } | undefined | null,
  /** Base units this document already took (editing a posted one); null = stock is not checked. */
  alreadyOut: number | null,
): PackLineInput | null {
  if (!product || product.type === 'service') return null;
  return {
    product_id: product.id,
    label: `${product.sku} ${product.name}`.trim(),
    quantity: l.quantity,
    factor: lineFactor(l),
    pack_name: l.product_unit_id ? l.unit_label ?? '—' : null,
    base_unit: facts.unitCode(product.unit_id),
    allows_decimals: facts.allowsDecimals(product.unit_id),
    net_price: l.net_price,
    base_price: Number(product.selling_price ?? 0),
    base_cost: stock?.mac ?? 0,
    on_hand: alreadyOut === null ? null : (stock?.qty ?? 0) + alreadyOut,
    ...(l.buying ? { buying: true } : {}),
  };
}

/** The cost to start from when a pack is picked while buying: its own purchase
 *  price, else the cost already typed, converted to the new unit. */
export function packCost(next: ProductUnitRow | null, typed: number, from: LinePack): number {
  if (next?.purchase_price != null) return next.purchase_price;
  return Math.round(typed * (next?.factor ?? 1) / lineFactor(from) * 100) / 100;
}

/** 91 → "7 BOX + 7 PCS", in the product's biggest whole pack; null when it has
 *  none, or the quantity does not reach one. */
export function packBreakdown(qty: number, packs: ProductUnitRow[], unit: string): string | null {
  const biggest = packs.filter((p) => p.factor > 1).sort((a, b) => b.factor - a.factor)[0];
  if (!biggest || qty < biggest.factor) return null;
  const n = Math.floor(qty / biggest.factor + 1e-9);
  const rest = Math.round((qty - n * biggest.factor) * 1000) / 1000;
  return rest > 0 ? `${fmtQty(n)} ${biggest.name} + ${fmtQty(rest)} ${unit}`.trim() : `${fmtQty(n)} ${biggest.name}`;
}
