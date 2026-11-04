/**
 * Global v1 — module-aware navigation and route gating.
 *
 * A path belongs to the module whose registry `areas` entry is its longest
 * prefix (so /products/vehicles is the automotive catalog, /products is
 * items). Paths no module claims — dashboard, settings, most reports — are
 * never gated: the financial statements and registers stay reachable
 * whatever is switched off.
 *
 * Historical records stay readable. A disabled module hides its lists and
 * its "new" screens, but the read view of a record that already exists
 * (`<area>/<uuid>`) is still allowed, so a ledger or report drill-down into
 * an old document keeps working after the module is turned off.
 */
import { MODULES, getModule, type ModuleKey } from './module-registry';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Registry areas that are real routes. Some entries describe a panel
// ("/sales/invoices (e-invoice panel)"); those gate nothing by path.
const AREAS: ReadonlyArray<{ area: string; module: ModuleKey }> = MODULES
  .flatMap((m) => m.areas.filter((a) => !a.includes(' ')).map((area) => ({ area, module: m.key })))
  .sort((a, b) => b.area.length - a.area.length);

function normalise(pathname: string): string {
  const p = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

/** The module that owns `pathname` and the matching area, or null when no module claims it. */
export function moduleForPath(pathname: string): { module: ModuleKey; area: string } | null {
  const p = normalise(pathname);
  for (const { area, module } of AREAS) {
    if (p === area || p.startsWith(`${area}/`)) return { module, area };
  }
  return null;
}

/** True for `<area>/<uuid>`: the read view of a record that already exists. */
export function isRecordView(pathname: string, area: string): boolean {
  const rest = normalise(pathname).slice(area.length).split('/').filter(Boolean);
  return rest.length === 1 && UUID.test(rest[0]);
}

export type PathAccess = 'allowed' | 'record_view' | 'module_disabled';

/**
 * Whether `pathname` may open with these modules enabled. Essential modules
 * are always on, whatever the list says.
 */
export function pathAccess(pathname: string, enabled: readonly ModuleKey[]): PathAccess {
  const owner = moduleForPath(pathname);
  if (!owner) return 'allowed';
  if (getModule(owner.module).essential || enabled.includes(owner.module)) return 'allowed';
  return isRecordView(pathname, owner.area) ? 'record_view' : 'module_disabled';
}

/** Navigation shows a link only when its page is fully open (not just its old records). */
export function navLinkEnabled(to: string, enabled: readonly ModuleKey[]): boolean {
  return pathAccess(to, enabled) === 'allowed';
}
