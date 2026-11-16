#!/usr/bin/env node
/**
 * phase136 — step 5 of a company deletion: empty its storage folders.
 *
 * SQL cannot delete Supabase storage objects, so platform_delete_company()
 * returns (and logs in platform_deletion_log.storage) the folders to empty:
 *   [{"bucket":"logos","prefix":"<company id>/"}, …,
 *    {"bucket":"support-attachments","prefix":"<ticket id>/"}]
 *
 *   node scripts/delete-company-storage.mjs --env <env file> <storage.json>             # dry run: lists only
 *   node scripts/delete-company-storage.mjs --env <env file> <storage.json> --execute   # deletes
 *
 * The env file must hold VITE_SUPABASE_URL and SUPABASE_SECRET_KEY (or
 * SUPABASE_SERVICE_ROLE_KEY). There is no default: you always name the target.
 * Each prefix must be exactly "<uuid>/", so a typo can never empty a bucket.
 * Nothing secret is printed — only bucket, path and counts.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const BUCKETS = new Set(['logos', 'products', 'attachments', 'support-attachments']);
const PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/;

function fail(msg) { console.error(`delete-company-storage: ${msg}`); process.exit(1); }

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const envAt = args.indexOf('--env');
if (envAt < 0 || !args[envAt + 1]) fail('give --env <file> (the project whose storage to empty)');
const envFile = args[envAt + 1];
const listFile = args.filter((a, i) => !a.startsWith('--') && i !== envAt + 1)[0];
if (!listFile) fail('give the storage JSON file (the "storage" array from platform_delete_company)');

const env = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail(`${envFile} needs VITE_SUPABASE_URL and SUPABASE_SECRET_KEY`);

let list;
try { list = JSON.parse(readFileSync(listFile, 'utf8')); } catch (e) { fail(`cannot read ${listFile}: ${e.message}`); }
if (!Array.isArray(list) || list.length === 0) fail('the storage list is empty or not an array');
for (const x of list) {
  if (!BUCKETS.has(x?.bucket)) fail(`unknown bucket ${JSON.stringify(x?.bucket)}`);
  if (!PREFIX.test(x?.prefix ?? '')) fail(`prefix must be "<uuid>/", got ${JSON.stringify(x?.prefix)}`);
}

const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

/** Every object path under bucket/prefix, folders included (list() is one level). */
async function walk(bucket, prefix) {
  const out = [];
  const queue = [prefix.replace(/\/$/, '')];
  while (queue.length) {
    const dir = queue.shift();
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await sb.storage.from(bucket).list(dir, { limit: 100, offset });
      if (error) throw new Error(`${bucket}/${dir}: ${error.message}`);
      for (const o of data) {
        const path = `${dir}/${o.name}`;
        if (o.id === null) queue.push(path); else out.push(path);   // id null = folder
      }
      if (data.length < 100) break;
    }
  }
  return out;
}

console.log(`${execute ? 'DELETING' : 'DRY RUN (nothing deleted)'} — target ${new URL(url).host}`);
let total = 0; let removed = 0;
for (const { bucket, prefix } of list) {
  let paths;
  try { paths = await walk(bucket, prefix); } catch (e) { fail(e.message); }
  total += paths.length;
  console.log(`  ${bucket}/${prefix}  ${paths.length} file(s)`);
  if (!execute) { for (const p of paths.slice(0, 20)) console.log(`      ${p}`); continue; }
  for (let i = 0; i < paths.length; i += 100) {
    const { data, error } = await sb.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) fail(`${bucket}: ${error.message} (after ${removed} removed — re-run to continue)`);
    removed += data.length;
  }
  const left = await walk(bucket, prefix);
  if (left.length) fail(`${bucket}/${prefix} still has ${left.length} file(s) — re-run`);
}
console.log(execute ? `done: ${removed} of ${total} file(s) removed, every folder now empty` : `${total} file(s) would be removed; add --execute to delete`);
