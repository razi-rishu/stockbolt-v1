/**
 * phase112 — a reversed depreciation / amortization period can be posted
 * again, and only one ACTIVE entry per period can exist. Static: reads the
 * migrations; the behaviour was tested on local staging.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(__dirname, '../../supabase/migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const strip = (s: string) => s.replace(/--[^\n]*/g, '');

/** The body of the last migration that defines `fn`. */
function latest(fn: string): { file: string; body: string } {
  let out: { file: string; body: string } | null = null;
  for (const f of files) {
    const sql = strip(readFileSync(join(DIR, f), 'utf8'));
    const m = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?AS \\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$`).exec(sql);
    if (m) out = { file: f, body: m[2] };
  }
  if (!out) throw new Error(`${fn} not found`);
  return out;
}
const phase112 = strip(readFileSync(join(DIR, '20261103000003_phase112_reversal_repost.sql'), 'utf8'));

describe('phase112 reversal + repost', () => {
  it('one ACTIVE entry per period, enforced by partial unique indexes', () => {
    expect(phase112).toMatch(/CREATE UNIQUE INDEX depreciation_entries_asset_period_active_key\s+ON public\.depreciation_entries \(asset_id, period_end\) WHERE reversed_at IS NULL;/);
    expect(phase112).toMatch(/CREATE UNIQUE INDEX amortization_entries_schedule_period_active_key\s+ON public\.amortization_entries \(schedule_id, period_index\) WHERE reversed_at IS NULL;/);
    expect(phase112).not.toMatch(/DELETE FROM|UPDATE public\.(depreciation|amortization)_entries/);
  });

  it.each([
    ['run_depreciation', /NOT EXISTS \(SELECT 1 FROM public\.depreciation_entries WHERE asset_id = v_asset\.id AND period_end = v_period AND reversed_at IS NULL\)/],
    ['run_amortization', /NOT EXISTS \(\s*SELECT 1 FROM public\.amortization_entries\s+WHERE schedule_id = v_s\.id AND period_index = v_i AND reversed_at IS NULL\s*\)/],
  ])('the current %s skips only periods with an active entry', (fn, re) => {
    const { file, body } = latest(fn);
    expect(file).toBe('20261103000003_phase112_reversal_repost.sql');
    expect(body).toMatch(re);
    expect(body).toMatch(/FOR UPDATE/);                          // runs are serialised per asset/schedule
    expect(body).toMatch(/auth_require\('accounting\.write'\)/);  // permission unchanged
  });

  it('the rollback is guarded', () => {
    const rb = readFileSync(resolve(__dirname, '../../supabase/manual-apply/phase112_rollback.sql'), 'utf8');
    expect(rb).toMatch(/RAISE EXCEPTION 'ROLLBACK GUARD:/);
  });
});
