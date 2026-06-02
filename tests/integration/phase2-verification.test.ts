/**
 * Phase 2 Verification Test
 *
 * Creates a Mercedes-Benz W213 brake pad product and asserts:
 *   1. Product is searchable by OE number
 *   2. Product is searchable by supplier SKU (cross-ref)
 *   3. Product appears via parts-catalog model lookup
 *
 * Full lifecycle: onboarding → make/model → brand → product → compat → supplier code → search
 *
 * Run with: npm run test:phase2
 */

import { beforeAll, describe, it, expect, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'node:path';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding, type WizardData } from '../../src/core/onboarding';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL        = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY   = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL)        throw new Error('Missing VITE_SUPABASE_URL in .env.local');
if (!SUPABASE_ANON_KEY)   throw new Error('Missing VITE_SUPABASE_PUBLISHABLE_KEY in .env.local');
if (!SUPABASE_SECRET_KEY) throw new Error('Missing SUPABASE_SECRET_KEY in .env.local');

const TAG           = Date.now();
const TEST_EMAIL    = `phase2-${TAG}@stockbolt.test`;
const TEST_PASSWORD = `Phase2!${TAG}`;

const adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let testUserId:    string | null = null;
let testCompanyId: string | null = null;
let adapter: ReturnType<typeof createSupabaseAdapter>;

// IDs created during test lifecycle
let makeId:    string;
let modelId:   string;
let brandId:   string;
let productId: string;
let supplierId: string;

beforeAll(async () => {
  // 1. Create pre-confirmed test user
  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createErr || !created.user) throw new Error(`admin.createUser: ${createErr?.message}`);
  testUserId = created.user.id;

  // 2. Sign in as that user
  const userClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInErr } = await userClient.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);

  adapter = createSupabaseAdapter(userClient);

  // 3. Run onboarding
  const wizard: WizardData = {
    full_name:            'Rashid Test',
    company_name:         'Phase 2 Test Auto',
    company_name_ar:      'اختبار المرحلة الثانية',
    address:              'Dubai',
    country_code:         'AE',
    is_tax_registered:    false,
    tax_id:               '',
    currency:             'AED',
    fiscal_year_start:    '2026-01-01',
    warehouse_name:       'Main',
    warehouse_name_ar:    'رئيسي',
    warehouse_code:       'MAIN',
    // Phase 14.13h removed the wizard bank step; WizardData no longer
    // carries bank_account_*, account_number, or bank_name fields.
    load_sample_data:     false,
  };
  const { company_id } = await runOnboarding(wizard, adapter);
  testCompanyId = company_id;

  // 4. Create vehicle make + model (Mercedes-Benz W213)
  const make = await adapter.vehicleMakes.create({ company_id, name: 'Mercedes-Benz' });
  makeId = make.id;
  const model = await adapter.vehicleMakes.createModel({ make_id: makeId, name: 'E-Class W213' });
  modelId = model.id;

  // 5. Create brand (Bosch)
  const brand = await adapter.brands.create({ company_id, name: 'Bosch', name_ar: 'بوش', logo_url: null });
  brandId = brand.id;

  // 6. Create a supplier contact
  const supplierContact = await adapter.contacts.create({
    company_id,
    name: 'Bosch Distribution',
    name_ar: null,
    type: 'supplier',
    email: null, phone: null, mobile: null,
    currency: 'AED',
    tax_id: null,
    address_street: null, address_city: null, address_state: null,
    address_postal: null, address_country: null, billing_address_ar: null,
    contact_person_name: null, contact_person_phone: null, contact_person_email: null,
    credit_limit: 0, payment_terms_days: 30,
    notes: null, is_active: true, default_price_level_id: null,
  });
  supplierId = supplierContact.id;

  // 7. Create the W213 brake pad product
  const product = await adapter.products.create({
    company_id,
    sku:            'BP-W213-001',
    barcode:        null,
    name:           'Brake Pad Set – Rear',
    name_ar:        'طقم تيل الفرامل – خلفي',
    description:    'OE-spec rear brake pads for Mercedes-Benz E-Class W213.',
    description_ar: null,
    oe_number:      'A0054201420',
    replacement_numbers: null,
    brand_id:       brandId,
    category_id:    null,
    unit_id:        null,
    quality_tier:   'genuine',
    selling_price:  285.00,
    tax_category:   'standard',
    min_stock_level: 2,
    requires_serial: false,
    is_active:      true,
    image_urls:     null,
  });
  productId = product.id;

  // 8. Link product → W213 model (compat row)
  await adapter.products.addCompatibility({
    product_id: productId,
    make_id:    makeId,
    model_id:   modelId,
    year_from:  2016,
    year_to:    null,
    engine:     null,
    notes:      null,
  });

  // 9. Add supplier cross-reference SKU
  await adapter.products.upsertSupplierCode({
    product_id:   productId,
    company_id,
    supplier_id:  supplierId,
    supplier_sku: 'BOSCH-BP456',
  });
}, 45_000);

afterAll(async () => {
  if (testCompanyId) {
    await adminClient.from('companies').delete().eq('id', testCompanyId);
  }
  if (testUserId) {
    await adminClient.auth.admin.deleteUser(testUserId);
  }
});

describe('Phase 2 — Master Data Verification', () => {
  it('product created: correct SKU, OE number, and quality tier', async () => {
    const { data } = await adminClient
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();
    expect(data).toBeTruthy();
    expect(data!.sku).toBe('BP-W213-001');
    expect(data!.oe_number).toBe('A0054201420');
    expect(data!.quality_tier).toBe('genuine');
    expect(Number(data!.selling_price)).toBe(285);
  });

  it('search by OE number returns the brake pad', async () => {
    const results = await adapter.products.search(testCompanyId!, 'A0054201420');
    const match = results.find((p) => p.id === productId);
    expect(match).toBeTruthy();
    expect(match!.sku).toBe('BP-W213-001');
  });

  it('search by partial SKU returns the brake pad', async () => {
    const results = await adapter.products.search(testCompanyId!, 'BP-W213');
    expect(results.some((p) => p.id === productId)).toBe(true);
  });

  it('search by supplier SKU (BOSCH-BP456) returns the brake pad', async () => {
    const results = await adapter.products.search(testCompanyId!, 'BOSCH-BP456');
    expect(results.some((p) => p.id === productId)).toBe(true);
  });

  it('parts catalog: listByModel returns brake pad for W213', async () => {
    const results = await adapter.products.listByModel(testCompanyId!, modelId);
    expect(results.some((p) => p.id === productId)).toBe(true);
  });

  it('parts catalog: year filter 2020 returns brake pad (fits 2016–present)', async () => {
    const results = await adapter.products.listByModel(testCompanyId!, modelId, 2020);
    expect(results.some((p) => p.id === productId)).toBe(true);
  });

  it('parts catalog: year filter 2010 returns empty (W213 starts 2016)', async () => {
    const results = await adapter.products.listByModel(testCompanyId!, modelId, 2010);
    expect(results.some((p) => p.id === productId)).toBe(false);
  });

  it('vehicle make + model created and listable', async () => {
    const makes = await adapter.vehicleMakes.list(testCompanyId!);
    const make = makes.find((m) => m.id === makeId);
    expect(make?.name).toBe('Mercedes-Benz');

    const models = await adapter.vehicleMakes.listModels(makeId);
    expect(models.some((m) => m.id === modelId && m.name === 'E-Class W213')).toBe(true);
  });

  it('brand created and listable', async () => {
    const brands = await adapter.brands.list(testCompanyId!);
    expect(brands.some((b) => b.id === brandId && b.name === 'Bosch')).toBe(true);
  });

  it('supplier contact created with type=supplier', async () => {
    const suppliers = await adapter.contacts.list(testCompanyId!, 'supplier');
    expect(suppliers.some((c) => c.id === supplierId)).toBe(true);
  });
});
