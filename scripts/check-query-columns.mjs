// Every literal .from('table') … .select('columns') in the app, run with limit 0
// against LOCAL staging only. Finds columns and embeds that do not exist: a
// report asking for one simply shows "no transactions". Read-only.
//   SEC=$(docker exec supabase_auth_stockbolt_local printenv GOTRUE_JWT_SECRET) node scripts/check-query-columns.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';

const env = Object.fromEntries(readFileSync('.env.staging.local', 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const base = env.VITE_SUPABASE_URL ?? '';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(base)) throw new Error('Local staging only.');
if (!process.env.SEC) throw new Error('Set SEC to the local GOTRUE_JWT_SECRET.');

const b64 = (b) => Buffer.from(b).toString('base64url');
const body = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify({ role: 'authenticated', sub: randomUUID(), exp: Math.floor(Date.now() / 1000) + 600 }))}`;
const jwt = `${body}.${createHmac('sha256', process.env.SEC).update(body).digest('base64url')}`;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (statSync(f).isDirectory()) walk(f);
    else if (/\.tsx?$/.test(f) && !/\.test\.|types.database/.test(f)) files.push(f);
  }
})('src');

let checked = 0;
const bad = [];
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\.from(?:\s+as\s+any\))?\(\s*'([a-z_]+)'(?:\s+as\s+[^)]+)?\s*\)[\s\S]{0,120}?\.select\(\s*(?:'([^']+)'|`([^`]+)`)/g)) {
    const cols = (m[2] ?? m[3]).replace(/\$\{costCol\}/g, ', cost_total');
    if (cols.includes('${')) continue;
    checked++;
    const r = await fetch(`${base}/rest/v1/${m[1]}?select=${encodeURIComponent(cols.replace(/\s+/g, ''))}&limit=0`,
      { headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${jwt}` } });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      bad.push(`${f}:${s.slice(0, m.index).split('\n').length}  ${m[1]}  ${j.code} ${j.message}`);
    }
  }
}
console.log(`${checked} queries checked, ${bad.length} failing`);
if (bad.length) { console.log(bad.join('\n')); process.exitCode = 1; }
