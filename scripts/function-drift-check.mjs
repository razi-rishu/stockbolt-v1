#!/usr/bin/env node
/**
 * Function drift check: does production run the functions the repo says it does?
 *
 * WHY
 * Migrations here are applied by hand in the SQL editor, and the database does
 * not record which ones ran. phase103 sat in the repo for a week while
 * production kept the old, unguarded delete_bank_reconciliation - nothing
 * noticed, because nothing compares the two. This does, for function bodies.
 *
 * HOW (read-only, no credentials, no network)
 * 1. In the Supabase SQL editor, run this read-only query and export the result
 *    as CSV (Results -> Export -> CSV):
 *
 *      select p.proname, pg_get_function_identity_arguments(p.oid) as args,
 *             md5(p.prosrc) as body_md5,
 *             md5(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) as body_md5_ws
 *      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 *      where n.nspname = 'public'
 *      order by 1, 2;
 *
 *    It returns function names and fingerprints only - no code, no data.
 * 2. node scripts/function-drift-check.mjs path/to/export.csv
 *
 * The script takes the LATEST definition of each function from
 * supabase/migrations (file order), fingerprints its body the same two ways,
 * and reports each function as one of:
 *   MATCH        identical to the repo
 *   WHITESPACE   same code, different spacing (harmless)
 *   DRIFT        production runs different code from the repo's latest version
 *   LIVE-ONLY    exists on production, defined in no migration
 *   REPO-ONLY    defined in a migration, missing on production
 * Exit code 1 if any DRIFT or REPO-ONLY is found, so it can gate a deploy.
 *
 * Limits: functions only (not policies, grants, views or triggers); overloads
 * are compared by name, so a name with several overloads is listed for review
 * rather than judged.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('usage: node scripts/function-drift-check.mjs <export.csv>');
  process.exit(2);
}

const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');
const wsMd5 = (s) => md5(s.replace(/\s+/g, ' ').trim());

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, commas inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ── Live fingerprints ───────────────────────────────────────────────────────
const [head, ...data] = parseCsv(readFileSync(csvPath, 'utf8').replace(/^﻿/, ''));
const col = (name) => {
  const i = head.indexOf(name);
  if (i === -1) { console.error(`CSV is missing column "${name}" - run the query in this file's header`); process.exit(2); }
  return i;
};
const [iName, iArgs, iMd5, iWs] = ['proname', 'args', 'body_md5', 'body_md5_ws'].map(col);
const live = new Map(); // name -> [{args, md5, ws}]
for (const r of data) {
  const list = live.get(r[iName]) ?? [];
  list.push({ args: r[iArgs], md5: r[iMd5], ws: r[iWs] });
  live.set(r[iName], list);
}

// ── Repo: latest body per function name ─────────────────────────────────────
const dir = resolve(process.cwd(), 'supabase/migrations');
const repo = new Map(); // name -> {file, body}
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const src = readFileSync(resolve(dir, file), 'utf8');
  const header = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi;
  for (const m of src.matchAll(header)) {
    const rest = src.slice(m.index + m[0].length);
    const tag = /\bAS\s+(\$[a-z_]*\$)/i.exec(rest);
    if (!tag) continue;
    const start = m.index + m[0].length + tag.index + tag[0].length;
    const end = src.indexOf(tag[1], start);
    if (end === -1) continue;
    repo.set(m[1].toLowerCase(), { file, body: src.slice(start, end) });
  }
}

// ── Compare ─────────────────────────────────────────────────────────────────
const result = { MATCH: [], WHITESPACE: [], DRIFT: [], 'LIVE-ONLY': [], 'REPO-ONLY': [], OVERLOADED: [] };
for (const [name, versions] of live) {
  const r = repo.get(name);
  if (!r) { result['LIVE-ONLY'].push(name); continue; }
  if (versions.length > 1) { result.OVERLOADED.push(`${name} (${versions.length} overloads; latest repo file ${r.file})`); continue; }
  const v = versions[0];
  const body = r.body.replace(/\r\n/g, '\n');
  if (md5(body) === v.md5) result.MATCH.push(name);
  else if (wsMd5(body) === v.ws) result.WHITESPACE.push(name);
  else result.DRIFT.push(`${name}  (repo: ${r.file})`);
}
for (const name of repo.keys()) if (!live.has(name)) result['REPO-ONLY'].push(`${name}  (repo: ${repo.get(name).file})`);

for (const [k, list] of Object.entries(result)) {
  console.log(`\n${k} (${list.length})`);
  if (k !== 'MATCH' && k !== 'WHITESPACE') for (const x of list.sort()) console.log(`  ${x}`);
}
process.exit(result.DRIFT.length || result['REPO-ONLY'].length ? 1 : 0);
