/**
 * seedSampleData — loads a small set of representative auto-parts data
 * so a brand-new company has something to explore right away.
 *
 * Seeded:
 *   • 3 vehicle makes + 2 models each (Toyota, Honda, Nissan)
 *   • 3 brands (Toyota OEM, NGK, Bosch)
 *   • 5 categories (Filters, Brakes, Electrical, Engine Parts, Transmission)
 *   • 2 customers, 2 suppliers
 *   • 10 products with OE numbers and vehicle compatibility
 */
import type { DataAdapter } from '@/data/adapter';

export async function seedSampleData(
  company_id: string,
  adapter: DataAdapter,
  _warehouse_id: string,
): Promise<void> {
  // ── 1. Categories ──────────────────────────────────────────────────────────
  const catFilters = await adapter.categories.create({ company_id, name: 'Filters',       name_ar: 'فلاتر',             parent_id: null, sort_order: 1, is_active: true });
  const catBrakes  = await adapter.categories.create({ company_id, name: 'Brakes',        name_ar: 'فرامل',             parent_id: null, sort_order: 2, is_active: true });
  const catElec    = await adapter.categories.create({ company_id, name: 'Electrical',    name_ar: 'كهربائي',           parent_id: null, sort_order: 3, is_active: true });
  const catEngine  = await adapter.categories.create({ company_id, name: 'Engine Parts',  name_ar: 'قطع المحرك',        parent_id: null, sort_order: 4, is_active: true });
  void adapter.categories.create({ company_id,   name: 'Transmission', name_ar: 'ناقل الحركة',       parent_id: null, sort_order: 5, is_active: true });

  // ── 2. Brands ─────────────────────────────────────────────────────────────
  const brandToyota = await adapter.brands.create({ company_id, name: 'Toyota OEM', name_ar: 'تويوتا الأصلي', logo_url: null, is_active: true });
  const brandNGK    = await adapter.brands.create({ company_id, name: 'NGK',        name_ar: 'NGK',           logo_url: null, is_active: true });
  const brandBosch  = await adapter.brands.create({ company_id, name: 'Bosch',      name_ar: 'بوش',           logo_url: null, is_active: true });

  // ── 3. Vehicle makes + models ──────────────────────────────────────────────
  const makeToyota = await adapter.vehicleMakes.create({ company_id, name: 'Toyota', logo_url: null });
  const makeHonda  = await adapter.vehicleMakes.create({ company_id, name: 'Honda',  logo_url: null });
  const makeNissan = await adapter.vehicleMakes.create({ company_id, name: 'Nissan', logo_url: null });

  // vehicleModels is created via vehicleMakes.createModel
  const modelCamry   = await adapter.vehicleMakes.createModel({ make_id: makeToyota.id, name: 'Camry'  });
  const modelCorolla = await adapter.vehicleMakes.createModel({ make_id: makeToyota.id, name: 'Corolla'});
  const modelAccord  = await adapter.vehicleMakes.createModel({ make_id: makeHonda.id,  name: 'Accord' });
  const modelCivic   = await adapter.vehicleMakes.createModel({ make_id: makeHonda.id,  name: 'Civic'  });
  const modelAltima  = await adapter.vehicleMakes.createModel({ make_id: makeNissan.id, name: 'Altima' });
  void adapter.vehicleMakes.createModel({ make_id: makeNissan.id, name: 'Patrol' });

  // ── 4. Customers & Suppliers ───────────────────────────────────────────────
  await adapter.contacts.create({
    company_id, name: 'Al Faris Auto Garage', name_ar: 'كراج الفارس',
    type: 'customer', email: 'alfaris@example.com', phone: '+971501234567',
    mobile: null, currency: 'AED', tax_id: null,
    address_street: 'Workshop Zone, Al Quoz', address_city: 'Dubai', address_country: 'AE',
    address_state: null, address_postal: null, billing_address_ar: null,
    contact_person_name: 'Ahmed Al Faris', contact_person_phone: null, contact_person_email: null,
    credit_limit: 10000, payment_terms_days: 30,
    notes: 'Toyota & Honda specialist', is_active: true, default_price_level_id: null,
  });
  await adapter.contacts.create({
    company_id, name: 'Star Motors Workshop', name_ar: 'ورشة ستار موتورز',
    type: 'customer', email: null, phone: '+97142345678',
    mobile: '+971551234567', currency: 'AED', tax_id: null,
    address_street: '15th Street, Industrial Area', address_city: 'Sharjah', address_country: 'AE',
    address_state: null, address_postal: null, billing_address_ar: null,
    contact_person_name: 'Khalid Hassan', contact_person_phone: null, contact_person_email: null,
    credit_limit: 5000, payment_terms_days: 15, notes: null, is_active: true, default_price_level_id: null,
  });
  await adapter.contacts.create({
    company_id, name: 'Gulf Auto Parts Trading', name_ar: 'خليج قطع السيارات',
    type: 'supplier', email: 'sales@gulfauto.ae', phone: '+97143456789',
    mobile: null, currency: 'AED', tax_id: '100234567890003',
    address_street: 'Ras Al Khor Industrial', address_city: 'Dubai', address_country: 'AE',
    address_state: null, address_postal: null, billing_address_ar: null,
    contact_person_name: 'Ravi Kumar', contact_person_phone: null, contact_person_email: null,
    credit_limit: 0, payment_terms_days: 45, notes: 'Toyota/Honda OEM supplier', is_active: true, default_price_level_id: null,
  });
  await adapter.contacts.create({
    company_id, name: 'Parts Direct FZE', name_ar: 'بارتس دايركت',
    type: 'supplier', email: 'info@partsdirect.ae', phone: '+97144567890',
    mobile: null, currency: 'USD', tax_id: null,
    address_street: 'Jafza, Gate 5', address_city: 'Dubai', address_country: 'AE',
    address_state: null, address_postal: null, billing_address_ar: null,
    contact_person_name: 'Mark Johnson', contact_person_phone: null, contact_person_email: null,
    credit_limit: 0, payment_terms_days: 30, notes: 'NGK & Bosch distributor', is_active: true, default_price_level_id: null,
  });

  // ── 5. Products ─────────────────────────────────────────────────────────────
  // Note: cost_price is not a DB column. selling_price is. MAC is tracked via stock_ledger.
  const baseProduct = {
    company_id,
    barcode: null,
    is_active: true,
    is_serialized: false,
    min_stock_level: 5,
    max_stock_level: null,
    reorder_point: 10,
    reorder_qty: 20,
    is_purchasable: true,
    is_saleable: true,
    description: null,
    description_ar: null,
    tax_category: 'standard' as const,
    unit_id: null,
  };

  type CompatEntry = { make_id: string; model_id: string | null; year_from: number; year_to: number };

  type ProductDef = {
    sku: string; name: string; name_ar: string; oe_number: string;
    category_id: string; brand_id: string;
    selling_price: number;
    compat: CompatEntry[];
  };

  const products: ProductDef[] = [
    {
      sku: 'FLT-OIL-T001', name: 'Oil Filter — Toyota 2.5L', name_ar: 'فلتر زيت تويوتا 2.5',
      oe_number: '90915-YZZD4', category_id: catFilters.id, brand_id: brandToyota.id, selling_price: 20,
      compat: [
        { make_id: makeToyota.id, model_id: modelCamry.id,   year_from: 2012, year_to: 2024 },
        { make_id: makeToyota.id, model_id: modelCorolla.id, year_from: 2010, year_to: 2024 },
      ],
    },
    {
      sku: 'FLT-AIR-T001', name: 'Air Filter — Toyota Camry', name_ar: 'فلتر هواء تويوتا كامري',
      oe_number: '17801-36020', category_id: catFilters.id, brand_id: brandToyota.id, selling_price: 35,
      compat: [{ make_id: makeToyota.id, model_id: modelCamry.id, year_from: 2018, year_to: 2024 }],
    },
    {
      sku: 'FLT-OIL-H001', name: 'Oil Filter — Honda 1.5T', name_ar: 'فلتر زيت هوندا 1.5',
      oe_number: '15400-PLM-A02', category_id: catFilters.id, brand_id: brandBosch.id, selling_price: 18,
      compat: [
        { make_id: makeHonda.id, model_id: modelCivic.id,  year_from: 2016, year_to: 2024 },
        { make_id: makeHonda.id, model_id: modelAccord.id, year_from: 2013, year_to: 2024 },
      ],
    },
    {
      sku: 'BRK-PAD-T001', name: 'Brake Pads Front — Toyota Camry', name_ar: 'تيل فرامل أمامي كامري',
      oe_number: '04465-33290', category_id: catBrakes.id, brand_id: brandToyota.id, selling_price: 85,
      compat: [{ make_id: makeToyota.id, model_id: modelCamry.id, year_from: 2018, year_to: 2024 }],
    },
    {
      sku: 'BRK-DISC-T001', name: 'Brake Disc Front — Toyota Corolla', name_ar: 'قرص فرامل كورولا',
      oe_number: '43512-02260', category_id: catBrakes.id, brand_id: brandToyota.id, selling_price: 120,
      compat: [{ make_id: makeToyota.id, model_id: modelCorolla.id, year_from: 2014, year_to: 2019 }],
    },
    {
      sku: 'ELC-SPK-NGK001', name: 'Spark Plug NGK G-Power', name_ar: 'شمعة إشعال NGK G-Power',
      oe_number: 'MKR6AP-11P', category_id: catElec.id, brand_id: brandNGK.id, selling_price: 15,
      compat: [
        { make_id: makeToyota.id, model_id: modelCamry.id,   year_from: 2012, year_to: 2024 },
        { make_id: makeToyota.id, model_id: modelCorolla.id, year_from: 2010, year_to: 2024 },
        { make_id: makeHonda.id,  model_id: modelAccord.id,  year_from: 2013, year_to: 2024 },
      ],
    },
    {
      sku: 'ELC-BAT-BSH01', name: 'Battery Bosch S4 60Ah', name_ar: 'بطارية بوش S4 60 أمبير',
      oe_number: 'BSH-S4-60', category_id: catElec.id, brand_id: brandBosch.id, selling_price: 280,
      compat: [
        { make_id: makeToyota.id, model_id: modelCamry.id,   year_from: 2010, year_to: 2024 },
        { make_id: makeHonda.id,  model_id: modelAccord.id,  year_from: 2013, year_to: 2024 },
      ],
    },
    {
      sku: 'ENG-BLT-T001', name: 'Timing Belt Kit — Toyota 2AZ', name_ar: 'جزام التوقيت تويوتا 2AZ',
      oe_number: 'TB-TOY-2AZ', category_id: catEngine.id, brand_id: brandToyota.id, selling_price: 170,
      compat: [{ make_id: makeToyota.id, model_id: modelCamry.id, year_from: 2012, year_to: 2017 }],
    },
    {
      sku: 'ENG-GSKT-H001', name: 'Head Gasket — Honda K24', name_ar: 'غاريه راس هوندا K24',
      oe_number: '12251-RNA-A01', category_id: catEngine.id, brand_id: brandBosch.id, selling_price: 110,
      compat: [{ make_id: makeHonda.id, model_id: modelAccord.id, year_from: 2013, year_to: 2022 }],
    },
    {
      sku: 'FLT-FUEL-N001', name: 'Fuel Filter — Nissan Altima', name_ar: 'فلتر وقود نيسان ألتيما',
      oe_number: '16400-3TA0A', category_id: catFilters.id, brand_id: brandBosch.id, selling_price: 42,
      compat: [{ make_id: makeNissan.id, model_id: modelAltima.id, year_from: 2013, year_to: 2021 }],
    },
  ];

  for (const p of products) {
    const product = await adapter.products.create({
      ...baseProduct,
      sku: p.sku,
      name: p.name,
      name_ar: p.name_ar,
      oe_number: p.oe_number,
      category_id: p.category_id,
      brand_id: p.brand_id,
      selling_price: p.selling_price,
    });

    for (const c of p.compat) {
      await adapter.products.addCompatibility({
        product_id: product.id,
        make_id:    c.make_id,
        model_id:   c.model_id,
        year_from:  c.year_from,
        year_to:    c.year_to,
        notes:      null,
        engine:     null,
      });
    }
  }
}
