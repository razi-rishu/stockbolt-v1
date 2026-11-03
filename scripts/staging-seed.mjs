#!/usr/bin/env node
/**
 * npm run staging:seed — load supabase/seeds/staging_reference_data.sql into the
 * LOCAL staging database, and nowhere else.
 *
 * WHY
 * Local staging is restored from a schema-only export, so the built-in roles,
 * role permissions, plan, tax profiles and make catalog are missing, and
 * role-based tests pass for the wrong reason: the first Finding E run on
 * 2026-11-03 failed E7 because role_permissions was empty.
 *
 * HOW IT STAYS LOCAL
 * - It takes no arguments and reads no environment variables: there is no way
 *   to hand it a URL, host, port or connection string.
 * - It talks to the database only through `docker exec` into the one container
 *   named below, after checking that container is running, healthy and labelled
 *   as the stockbolt_local Supabase CLI project.
 * - psql inside the container connects over its unix socket, and the seed
 *   itself refuses any TCP session (inet_server_addr() IS NOT NULL), so pasting
 *   the file into the Supabase dashboard or pointing psql at a cloud host fails.
 * - The seed is one transaction: any failed assertion rolls everything back.
 *
 * Nothing runs it automatically: it is not called by build, prepare, the
 * pre-commit hook, CI, Vercel or `supabase db reset` (config.toml seeds only
 * ./seed.sql). tests/unit/staging-seed.test.ts checks all of that.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTAINER = 'supabase_db_stockbolt_local';
const PROJECT_LABEL = 'stockbolt_local';
const SEED = resolve(dirname(fileURLToPath(import.meta.url)), '../supabase/seeds/staging_reference_data.sql');

function fail(message) {
  console.error(`\n[staging:seed] REFUSED: ${message}\n`);
  process.exit(1);
}

if (process.argv.length > 2) {
  fail('this command takes no arguments. It only ever targets the local container ' + CONTAINER + '.');
}

// docker inspect, not docker ps: an exact name match, never a prefix or filter.
const inspect = spawnSync('docker', ['inspect', '--type', 'container', CONTAINER, '--format',
  '{{json .State.Running}}|{{json .State.Health.Status}}|{{index .Config.Labels "com.supabase.cli.project"}}|{{.Config.Image}}'],
  { encoding: 'utf8' });
if (inspect.status !== 0) fail(`container ${CONTAINER} not found. Start the local stack (supabase start in stockbolt_local).`);
const [running, health, label, image] = inspect.stdout.trim().split('|');
if (running !== 'true') fail(`${CONTAINER} is not running.`);
if (health !== '"healthy"') fail(`${CONTAINER} is not healthy (${health}).`);
if (label !== PROJECT_LABEL) fail(`${CONTAINER} is not labelled as Supabase CLI project ${PROJECT_LABEL} (found "${label}").`);
if (!/^public\.ecr\.aws\/supabase\/postgres:|^supabase\/postgres:/.test(image)) fail(`${CONTAINER} does not run a Supabase Postgres image (${image}).`);

const sql = readFileSync(SEED, 'utf8');
console.log(`[staging:seed] ${CONTAINER} (project ${PROJECT_LABEL}, ${image}) — applying ${SEED}`);

// -X: ignore any psqlrc. No shell: the arguments are passed as-is.
const run = spawnSync('docker', ['exec', '-i', CONTAINER, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8' });
process.stdout.write(run.stdout ?? '');
process.stderr.write(run.stderr ?? '');
if (run.status !== 0) fail('the seed failed and was rolled back. Nothing was changed.');
console.log('[staging:seed] done: reference data present and verified.');
