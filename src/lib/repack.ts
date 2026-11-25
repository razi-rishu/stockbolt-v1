/** Repack (phase157): what the screen checks before it saves, and what it will
 *  cost. The database works out the exact cost; this is the preview. */
export interface RepackLine { kind: 'input' | 'waste'; product_id: string; quantity: number }
export interface RepackStock { qty: number; mac: number }

export interface RepackProblem {
  kind: 'no_output' | 'no_input' | 'same_product' | 'whole_units' | 'not_enough' | 'no_cost';
  product_id?: string;
  have?: number;
  need?: number;
}
export interface RepackCheck {
  /** Value of the goods used (what the goods made will be worth). */
  value: number;
  unit_cost: number;
  waste: number;
  problems: RepackProblem[];
}

export function checkRepack(
  output: { product_id: string | null; quantity: number },
  lines: RepackLine[],
  stock: (product_id: string) => RepackStock | undefined,
  allowsDecimals: (product_id: string) => boolean,
): RepackCheck {
  const c: RepackCheck = { value: 0, unit_cost: 0, waste: 0, problems: [] };
  const whole = (product_id: string, q: number) => {
    if (!Number.isInteger(q) && !allowsDecimals(product_id)) c.problems.push({ kind: 'whole_units', product_id });
  };
  if (!output.product_id || !(output.quantity > 0)) c.problems.push({ kind: 'no_output' });
  else whole(output.product_id, output.quantity);
  if (!lines.some((l) => l.kind === 'input')) c.problems.push({ kind: 'no_input' });

  const need = new Map<string, number>();
  for (const l of lines) {
    if (l.product_id === output.product_id) c.problems.push({ kind: 'same_product', product_id: l.product_id });
    whole(l.product_id, l.quantity);
    need.set(l.product_id, (need.get(l.product_id) ?? 0) + l.quantity);
    const cost = l.quantity * (stock(l.product_id)?.mac ?? 0);
    if (l.kind === 'waste') c.waste += cost; else c.value += cost;
  }
  for (const [product_id, n] of need) {
    const s = stock(product_id);
    if (!s) continue; // not read yet: the database decides
    if (s.qty + 1e-9 < n) c.problems.push({ kind: 'not_enough', product_id, have: s.qty, need: n });
    else if (!(s.mac > 0)) c.problems.push({ kind: 'no_cost', product_id });
  }
  c.value = Math.round(c.value * 100) / 100;
  c.waste = Math.round(c.waste * 100) / 100;
  c.unit_cost = output.quantity > 0 ? Math.round((c.value / output.quantity) * 100) / 100 : 0;
  return c;
}
