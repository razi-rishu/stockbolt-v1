/**
 * phase126 — Fixed asset purchase: pure helpers.
 *
 * The page keeps one list of asset lines and, on save, turns it into the
 * document that carries the purchase:
 *   credit      → a vendor bill (items with coa_account_id = the asset account)
 *   cash / bank → an expense    (items with expense_account_id = the asset account)
 *
 * Line maths is the vendor bill's own (calcPurchaseLine), so a credit purchase
 * totals exactly as New Bill would. No posting happens here — the database
 * engines post (confirm_vendor_bill / confirm_expense via
 * post_fixed_asset_purchase).
 */
import { calcPurchaseLine } from '@/core/purchasing/purchase-calc';
import type {
  AssetPurchasePaymentType, AssetPurchaseSpec, DepreciationMethodDb,
  ExpenseItemInsert, VendorBillItemInsert,
} from '@/data/adapter';

export interface AssetLine {
  key: string;
  /** Asset name — also the line description on the bill / expense. */
  name: string;
  asset_account_id: string;
  quantity: string;
  unit_cost: string;
  discount_percent: string;
  tax_rate: string;
  warehouse_id: string;
  // Register details (kept on the purchase until it posts)
  asset_tag: string;
  category: string;
  in_service_date: string;
  salvage_value: string;
  useful_life_months: string;
  method: DepreciationMethodDb;
  wdv_rate: string;
}

let seq = 0;
export function newAssetLine(defaults: Partial<AssetLine> = {}): AssetLine {
  seq += 1;
  return {
    key: `al${seq}`,
    name: '', asset_account_id: '', quantity: '1', unit_cost: '0', discount_percent: '0', tax_rate: '0',
    warehouse_id: '', asset_tag: '', category: '', in_service_date: '',
    salvage_value: '0', useful_life_months: '60', method: 'straight_line', wdv_rate: '0',
    ...defaults,
  };
}

const num = (s: string) => parseFloat(s) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function lineAmounts(l: AssetLine, inclusive: boolean) {
  return calcPurchaseLine({
    quantity: num(l.quantity), unit_cost: num(l.unit_cost),
    discount_percent: num(l.discount_percent), tax_rate: num(l.tax_rate), inclusive,
  });
}

/** What the asset will cost in the register: net of discount, excluding recoverable tax. */
export function lineAssetCost(l: AssetLine, inclusive: boolean): number {
  const a = lineAmounts(l, inclusive);
  return r2(a.line_total - a.tax_amount);
}

export function purchaseTotals(lines: AssetLine[], inclusive: boolean, roundOff: number) {
  const rows = lines.map((l) => lineAmounts(l, inclusive));
  const subtotal = r2(rows.reduce((s, x) => s + x.line_subtotal, 0));
  const discount = r2(rows.reduce((s, x) => s + x.discount_amount, 0));
  const tax = r2(rows.reduce((s, x) => s + x.tax_amount, 0));
  const lineTotal = r2(rows.reduce((s, x) => s + x.line_total, 0));
  return { subtotal, discount, tax, roundOff: r2(roundOff), total: r2(lineTotal + roundOff) };
}

export function docTypeFor(p: AssetPurchasePaymentType): 'vendor_bill' | 'expense' {
  return p === 'credit' ? 'vendor_bill' : 'expense';
}

export function specsFromLines(lines: AssetLine[]): AssetPurchaseSpec[] {
  return lines.map((l, i) => ({
    sort_order: i,
    name: l.name.trim(),
    asset_tag: l.asset_tag.trim() || null,
    category: l.category.trim() || null,
    in_service_date: l.in_service_date || null,
    salvage_value: num(l.salvage_value),
    useful_life_months: Math.max(1, Math.round(num(l.useful_life_months)) || 60),
    method: l.method,
    wdv_rate: num(l.wdv_rate),
  }));
}

export function billItemsFromLines(lines: AssetLine[], inclusive: boolean): VendorBillItemInsert[] {
  return lines.map((l, i) => {
    const a = lineAmounts(l, inclusive);
    return {
      bill_id: '', product_id: null, coa_account_id: l.asset_account_id || null,
      warehouse_id: l.warehouse_id || null,
      description: l.name.trim() || null, description_ar: null,
      quantity: num(l.quantity), unit_id: null, unit_cost: num(l.unit_cost),
      discount_percent: num(l.discount_percent), discount_amount: a.discount_amount,
      tax_category: 'standard', tax_rate: num(l.tax_rate) || null, tax_amount: a.tax_amount,
      line_subtotal: a.line_subtotal, line_total: a.line_total,
      linked_grn_item_id: null, sort_order: i,
    } as unknown as VendorBillItemInsert;
  });
}

/**
 * Expense items carry no discount column, so the line is stored net of its
 * discount: line_subtotal = what is debited to the asset account. The unit
 * amount is derived for display only.
 */
export function expenseItemsFromLines(lines: AssetLine[], inclusive: boolean): ExpenseItemInsert[] {
  return lines.map((l, i) => {
    const a = lineAmounts(l, inclusive);
    const net = r2(a.line_total - a.tax_amount);
    const qty = num(l.quantity) || 1;
    return {
      sort_order: i,
      expense_account_id: l.asset_account_id,
      description: l.name.trim() || null,
      quantity: qty,
      unit_amount: Math.round((net / qty) * 10000) / 10000,
      tax_rate: num(l.tax_rate),
      tax_amount: a.tax_amount,
      line_subtotal: net,
      line_total: a.line_total,
      is_billable: false,
      customer_id: null,
    } as unknown as ExpenseItemInsert;
  });
}

/** Problems that would stop a save; empty when the purchase can be saved. */
export function validateLines(lines: AssetLine[]): string[] {
  const errs: string[] = [];
  if (lines.length === 0) errs.push('apOcean.err_no_lines');
  lines.forEach((l) => {
    if (!l.name.trim()) errs.push('apOcean.err_name');
    if (!l.asset_account_id) errs.push('apOcean.err_account');
    if (!(num(l.quantity) > 0)) errs.push('apOcean.err_qty');
    if (!(num(l.unit_cost) > 0)) errs.push('apOcean.err_cost');
  });
  return [...new Set(errs)];
}
