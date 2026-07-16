/**
 * StockBolt Public API — v1 (Phase 50 / M-API 2).
 *
 * Customer-facing REST API. A tenant mints an API key in Settings →
 * Developer & API and calls:
 *
 *   https://<project-ref>.supabase.co/functions/v1/api/v1/...
 *   Authorization: Bearer sk_live_...
 *
 * Endpoints (this phase — read-only):
 *   GET /v1/me                     key check: company + scopes (no data)
 *   GET /v1/products               ?search= &active= &include=stock &limit= &offset=
 *   GET /v1/contacts               ?type=customer|supplier &search= &limit= &offset=
 *   GET /v1/invoices               ?status= &from= &to= &limit= &offset=
 *   GET /v1/invoices/:id           header + line items
 *
 * Security model:
 *   • This function runs with the SERVICE ROLE (bypasses RLS), so tenant
 *     isolation is enforced HERE: the bearer key is SHA-256-hashed and looked
 *     up in api_keys; every query is filtered by that key's company_id.
 *     The raw key is never stored anywhere — only its hash.
 *   • Deployed with --no-verify-jwt (callers are external apps, not Supabase
 *     users); our own key auth replaces the JWT check.
 *   • Rate limit: 120 requests/min per key (counted from api_request_log).
 *   • Every request is logged to api_request_log (metering + audit).
 *   • Response field allow-lists: internal/margin fields (cost_at_sale,
 *     company_id, …) are never exposed.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const RATE_LIMIT_PER_MIN = 120;
const MAX_LIMIT = 200;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

// ── helpers ─────────────────────────────────────────────────────────────────
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
function err(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function parsePage(url: URL): { limit: number; offset: number } {
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50') || 50, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0') || 0, 0);
  return { limit, offset };
}

/** Escape %/_ so user input can't act as wildcards inside our ilike pattern. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ApiKey {
  id: string;
  company_id: string;
  scopes: string[];
}

// ── auth: bearer key → api_keys row ────────────────────────────────────────
async function authenticate(req: Request): Promise<ApiKey | Response> {
  const header = req.headers.get('authorization') ?? '';
  const m = header.match(/^Bearer\s+(sk_live_[A-Za-z0-9]+)$/);
  if (!m) return err(401, 'unauthorized', 'Missing or malformed Authorization header. Use: Authorization: Bearer sk_live_...');

  const hash = await sha256Hex(m[1]);
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, company_id, scopes, revoked_at, expires_at')
    .eq('key_hash', hash)
    .maybeSingle();
  if (error) return err(500, 'internal', 'Key lookup failed.');
  if (!data || data.revoked_at) return err(401, 'unauthorized', 'Invalid or revoked API key.');
  if (data.expires_at && new Date(data.expires_at) < new Date()) return err(401, 'unauthorized', 'API key has expired.');
  return { id: data.id, company_id: data.company_id, scopes: data.scopes ?? [] };
}

async function rateLimited(key: ApiKey): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from('api_request_log')
    .select('id', { count: 'exact', head: true })
    .eq('api_key_id', key.id)
    .gte('created_at', since);
  return (count ?? 0) >= RATE_LIMIT_PER_MIN;
}

// ── endpoints ───────────────────────────────────────────────────────────────
async function getMe(key: ApiKey): Promise<Response> {
  const { data } = await supabase.from('companies')
    .select('name, base_currency').eq('id', key.company_id).maybeSingle();
  return json(200, {
    company: data?.name ?? null,
    currency: (data as { base_currency?: string } | null)?.base_currency ?? null,
    scopes: key.scopes,
    version: 'v1',
  });
}

async function listProducts(key: ApiKey, url: URL): Promise<Response> {
  const { limit, offset } = parsePage(url);
  let q = supabase.from('products')
    .select('id, sku, barcode, name, description, oe_number, selling_price, tax_category, is_active, created_at, updated_at, brands(name), categories(name)')
    .eq('company_id', key.company_id)
    .order('sku')
    .range(offset, offset + limit); // limit+1 rows → has_more
  const active = url.searchParams.get('active');
  if (active === 'true') q = q.eq('is_active', true);
  if (active === 'false') q = q.eq('is_active', false);
  const search = url.searchParams.get('search');
  if (search) {
    const s = likeEscape(search.trim());
    q = q.or(`sku.ilike.%${s}%,name.ilike.%${s}%,oe_number.ilike.%${s}%`);
  }
  const { data, error } = await q;
  if (error) return err(500, 'internal', 'Query failed.');

  const rows = (data ?? []) as Record<string, unknown>[];
  const page = rows.slice(0, limit);

  // Optional stock quantities via the service-role-only aggregate RPC.
  let stock: Record<string, number> | null = null;
  if (url.searchParams.get('include') === 'stock') {
    const { data: sdata, error: serror } = await supabase.rpc('api_current_stock', { p_company_id: key.company_id });
    if (serror) return err(500, 'internal', 'Stock lookup failed.');
    stock = {};
    for (const r of (sdata ?? []) as { product_id: string; qty: number }[]) stock[r.product_id] = Number(r.qty);
  }

  return json(200, {
    data: page.map((p) => ({
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      description: p.description,
      oe_number: p.oe_number,
      brand: (p.brands as { name?: string } | null)?.name ?? null,
      category: (p.categories as { name?: string } | null)?.name ?? null,
      selling_price: Number(p.selling_price),
      tax_category: p.tax_category,
      is_active: p.is_active,
      ...(stock ? { stock_qty: stock[p.id as string] ?? 0 } : {}),
      created_at: p.created_at,
      updated_at: p.updated_at,
    })),
    pagination: { limit, offset, has_more: rows.length > limit },
  });
}

async function listContacts(key: ApiKey, url: URL): Promise<Response> {
  const { limit, offset } = parsePage(url);
  let q = supabase.from('contacts')
    .select('id, code, name, type, email, phone, mobile, currency, tax_id, address_street, address_city, address_country, credit_limit, payment_terms_days, is_active, created_at, updated_at')
    .eq('company_id', key.company_id)
    .order('name')
    .range(offset, offset + limit);
  const type = url.searchParams.get('type');
  if (type === 'customer' || type === 'supplier') q = q.in('type', [type, 'both']);
  const search = url.searchParams.get('search');
  if (search) {
    const s = likeEscape(search.trim());
    q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
  }
  const { data, error } = await q;
  if (error) return err(500, 'internal', 'Query failed.');
  const rows = (data ?? []) as Record<string, unknown>[];
  return json(200, {
    data: rows.slice(0, limit),
    pagination: { limit, offset, has_more: rows.length > limit },
  });
}

async function listInvoices(key: ApiKey, url: URL): Promise<Response> {
  const { limit, offset } = parsePage(url);
  let q = supabase.from('invoices')
    .select('id, invoice_number, date, due_date, status, currency, subtotal, discount_amount, tax_amount, total_amount, reference, notes, created_at, contacts(id, name, email)')
    .eq('company_id', key.company_id)
    .order('date', { ascending: false })
    .order('invoice_number', { ascending: false })
    .range(offset, offset + limit);
  const status = url.searchParams.get('status');
  if (status && ['draft', 'confirmed', 'void'].includes(status)) q = q.eq('status', status);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (from && ISO_DATE.test(from)) q = q.gte('date', from);
  if (to && ISO_DATE.test(to)) q = q.lte('date', to);
  const { data, error } = await q;
  if (error) return err(500, 'internal', 'Query failed.');

  const rows = (data ?? []) as Record<string, unknown>[];
  return json(200, {
    data: rows.slice(0, limit).map((i) => ({
      id: i.id,
      invoice_number: i.invoice_number,
      date: i.date,
      due_date: i.due_date,
      status: i.status,
      currency: i.currency,
      subtotal: Number(i.subtotal),
      discount_amount: Number(i.discount_amount),
      tax_amount: Number(i.tax_amount),
      total_amount: Number(i.total_amount),
      reference: i.reference,
      customer: i.contacts ?? null,
      created_at: i.created_at,
    })),
    pagination: { limit, offset, has_more: rows.length > limit },
  });
}

async function getInvoice(key: ApiKey, id: string): Promise<Response> {
  const { data: inv, error } = await supabase.from('invoices')
    .select('id, invoice_number, date, due_date, status, currency, subtotal, discount_amount, tax_amount, total_amount, reference, notes, created_at, contacts(id, name, email, phone)')
    .eq('company_id', key.company_id)
    .eq('id', id)
    .maybeSingle();
  if (error) return err(500, 'internal', 'Query failed.');
  if (!inv) return err(404, 'not_found', 'Invoice not found.');

  // Line items — cost_at_sale (margin data) is deliberately NOT exposed.
  const { data: items, error: ierror } = await supabase.from('invoice_items')
    .select('id, description, quantity, unit_price, discount_amount, tax_amount, line_total, sort_order, products(sku, name)')
    .eq('invoice_id', id)
    .order('sort_order');
  if (ierror) return err(500, 'internal', 'Query failed.');

  return json(200, {
    data: {
      ...inv,
      customer: (inv as Record<string, unknown>).contacts ?? null,
      contacts: undefined,
      items: (items ?? []).map((it) => ({
        id: it.id,
        sku: (it.products as { sku?: string } | null)?.sku ?? null,
        name: (it.products as { name?: string } | null)?.name ?? null,
        description: it.description,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        discount_amount: Number(it.discount_amount),
        tax_amount: Number(it.tax_amount),
        line_total: Number(it.line_total),
      })),
    },
  });
}

// ── writes: contacts (Phase 3 — scope write:contacts) ──────────────────────
// Field allow-lists. Deliberately NOT writable via API: credit_limit and
// price levels (risk controls the merchant sets in-app), code, company_id.
// currency is create-only — changing it under existing documents is unsafe.
const CONTACT_CREATE_FIELDS = [
  'name', 'name_ar', 'type', 'email', 'phone', 'mobile', 'tax_id', 'currency',
  'address_street', 'address_city', 'address_state', 'address_country', 'address_postal',
  'contact_person_name', 'contact_person_phone', 'contact_person_email',
  'payment_terms_days', 'notes',
];
const CONTACT_PATCH_FIELDS = [...CONTACT_CREATE_FIELDS.filter((f) => f !== 'currency'), 'is_active'];
const CONTACT_RETURN_COLS =
  'id, code, name, type, email, phone, mobile, currency, tax_id, address_street, address_city, address_country, credit_limit, payment_terms_days, is_active, created_at, updated_at';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

async function readJsonBody(req: Request): Promise<Record<string, unknown> | Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return err(400, 'bad_request', 'Body must be valid JSON.'); }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return err(400, 'bad_request', 'Body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}

/** Validate + trim the writable fields. Strict: unknown keys are a 400 so
 *  integrators catch typos instead of silently losing data. */
function pickContactFields(body: Record<string, unknown>, allowed: string[]): Record<string, unknown> | Response {
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    return err(400, 'bad_request', `Unknown field(s): ${unknown.join(', ')}. Writable: ${allowed.join(', ')}.`);
  }
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (!(k in body)) continue;
    const v = body[k];
    if (k === 'payment_terms_days') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 730) return err(400, 'bad_request', 'payment_terms_days must be an integer between 0 and 730.');
      out[k] = n;
    } else if (k === 'is_active') {
      if (typeof v !== 'boolean') return err(400, 'bad_request', 'is_active must be true or false.');
      out[k] = v;
    } else if (v === null) {
      out[k] = null;
    } else if (typeof v === 'string') {
      const s = v.trim();
      if (s.length > 500) return err(400, 'bad_request', `${k} exceeds 500 characters.`);
      out[k] = s === '' ? null : s;
    } else {
      return err(400, 'bad_request', `${k} must be a string${k === 'payment_terms_days' ? '' : ' or null'}.`);
    }
  }
  if (typeof out.type === 'string' && !['customer', 'supplier', 'both'].includes(out.type as string)) {
    return err(400, 'bad_request', "type must be 'customer', 'supplier' or 'both'.");
  }
  if (typeof out.email === 'string' && !EMAIL_RE.test(out.email as string)) {
    return err(400, 'bad_request', 'email is not a valid address.');
  }
  return out;
}

/** Case-insensitive same-company email match (dedupe guard). */
async function findByEmail(companyId: string, email: string, excludeId?: string): Promise<string | null> {
  let q = supabase.from('contacts').select('id')
    .eq('company_id', companyId)
    .ilike('email', likeEscape(email))
    .limit(1);
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q;
  return (data?.[0]?.id as string | undefined) ?? null;
}

async function createContact(key: ApiKey, req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  if (body instanceof Response) return body;
  const fields = pickContactFields(body, CONTACT_CREATE_FIELDS);
  if (fields instanceof Response) return fields;

  if (typeof fields.name !== 'string' || fields.name === null || fields.name === '') {
    return err(400, 'bad_request', 'name is required.');
  }
  if (!fields.type) fields.type = 'customer';

  // Duplicate guard: one contact per email per company. 409 carries the
  // existing id so the integrator can PATCH instead (also makes naive
  // create-retries safe).
  if (typeof fields.email === 'string') {
    const existing = await findByEmail(key.company_id, fields.email);
    if (existing) return json(409, { error: { code: 'conflict', message: 'A contact with this email already exists.', existing_id: existing } });
  }

  if (typeof fields.currency === 'string') {
    if (!/^[A-Z]{3}$/.test(fields.currency as string)) return err(400, 'bad_request', 'currency must be a 3-letter code, e.g. AED.');
  } else {
    const { data: co } = await supabase.from('companies').select('base_currency').eq('id', key.company_id).maybeSingle();
    fields.currency = (co as { base_currency?: string } | null)?.base_currency ?? 'AED';
  }

  const { data, error } = await supabase.from('contacts')
    .insert({ ...fields, company_id: key.company_id, is_active: true })
    .select(CONTACT_RETURN_COLS)
    .single();
  if (error) return err(500, 'internal', 'Insert failed.');
  return json(201, { data });
}

async function updateContact(key: ApiKey, id: string, req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  if (body instanceof Response) return body;
  const fields = pickContactFields(body, CONTACT_PATCH_FIELDS);
  if (fields instanceof Response) return fields;
  if (Object.keys(fields).length === 0) return err(400, 'bad_request', 'No writable fields in body.');
  if ('name' in fields && (fields.name === null || fields.name === '')) {
    return err(400, 'bad_request', 'name cannot be empty.');
  }

  const { data: existing } = await supabase.from('contacts').select('id')
    .eq('company_id', key.company_id).eq('id', id).maybeSingle();
  if (!existing) return err(404, 'not_found', 'Contact not found.');

  if (typeof fields.email === 'string') {
    const dupe = await findByEmail(key.company_id, fields.email, id);
    if (dupe) return json(409, { error: { code: 'conflict', message: 'Another contact already uses this email.', existing_id: dupe } });
  }

  const { data, error } = await supabase.from('contacts')
    .update(fields)
    .eq('company_id', key.company_id).eq('id', id)
    .select(CONTACT_RETURN_COLS)
    .single();
  if (error) return err(500, 'internal', 'Update failed.');
  return json(200, { data });
}

// ── router ──────────────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireScope(key: ApiKey, scope: string): Response | null {
  return key.scopes.includes(scope)
    ? null
    : err(403, 'forbidden', `This key lacks the '${scope}' scope.`);
}

async function route(req: Request, key: ApiKey, path: string, url: URL): Promise<Response> {
  const method = req.method;

  // Writes (Phase 3): contacts.
  if (path === '/v1/contacts' && method === 'POST') {
    return requireScope(key, 'write:contacts') ?? createContact(key, req);
  }
  const contact = path.match(/^\/v1\/contacts\/([^/]+)$/);
  if (contact && method === 'PATCH') {
    if (!UUID.test(contact[1])) return err(400, 'bad_request', 'Contact id must be a UUID.');
    return requireScope(key, 'write:contacts') ?? updateContact(key, contact[1], req);
  }
  if (path === '/v1/orders' && method === 'POST') {
    return err(501, 'not_implemented', 'Order creation arrives in the next version of the API.');
  }

  // Reads.
  if (method !== 'GET') return err(405, 'method_not_allowed', `${method} is not supported on ${path}.`);
  const readGate = requireScope(key, 'read');
  if (readGate) return readGate;

  if (path === '/v1/me') return getMe(key);
  if (path === '/v1/products') return listProducts(key, url);
  if (path === '/v1/contacts') return listContacts(key, url);
  if (path === '/v1/invoices') return listInvoices(key, url);
  const inv = path.match(/^\/v1\/invoices\/([^/]+)$/);
  if (inv) {
    if (!UUID.test(inv[1])) return err(400, 'bad_request', 'Invoice id must be a UUID.');
    return getInvoice(key, inv[1]);
  }
  return err(404, 'not_found', `No route for ${path}. See /v1/me, /v1/products, /v1/contacts, /v1/invoices.`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  // Path arrives as /api/v1/... (function name prefix) — strip the prefix.
  const path = url.pathname.replace(/^.*?\/api(?=\/)/, '');

  const started = Date.now();
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;

  if (await rateLimited(auth)) {
    return err(429, 'rate_limited', `Rate limit exceeded (${RATE_LIMIT_PER_MIN} requests/min per key). Slow down and retry.`);
  }

  let res: Response;
  try {
    res = await route(req, auth, path, url);
  } catch (_e) {
    res = err(500, 'internal', 'Unexpected error.');
  }

  // Usage log + last_used_at (await both — cheap, and Edge workers may be
  // torn down right after the response otherwise).
  await supabase.from('api_request_log').insert({
    company_id: auth.company_id,
    api_key_id: auth.id,
    method: req.method,
    path,
    status_code: res.status,
    duration_ms: Date.now() - started,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', auth.id);

  return res;
});
