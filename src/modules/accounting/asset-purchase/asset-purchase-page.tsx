/**
 * phase126 — New Asset: register an asset, or buy it on credit / by cash / by bank.
 *
 * Routes: /accounting/fixed-assets/new            (new)
 *         /accounting/fixed-assets/purchase/:id   (a saved purchase)
 *
 * "Register only" keeps the original New Asset behaviour: the register row is
 * written and nothing posts. The three purchase types build the document the
 * books already post — a vendor bill for credit, an expense for cash / bank —
 * and post_fixed_asset_purchase confirms it and creates one register row per
 * line in the same transaction. Layout follows New Bill (Ocean Teal).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CircleCheck, CreditCard, Landmark, Pencil, Save, Trash2, Wallet, ClipboardList } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { useCompanyCurrency, useCompanyCountry, useTaxName, useVatApplies } from '@/hooks/use-company-currency';
import { defaultTaxRate } from '@/lib/locale';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { BackButton } from '@/ui/back-button';
import { StatusBadge } from '@/ui/status-badge';
import { SearchableSelect } from '@/ui/searchable-select';
import { DocLink } from '@/ui/doc-link';
import '@/styles/stockbolt-ocean-teal.css';
import type {
  AssetPurchasePaymentType, BankAccountRow, CoaRow, ContactRow, ExpenseInsert,
  FixedAssetPurchaseRow, TaxRateRow,
} from '@/data/adapter';
import { AssetPurchaseLines } from './asset-purchase-lines';
import {
  billItemsFromLines, docTypeFor, expenseItemsFromLines, lineAssetCost, newAssetLine,
  purchaseTotals, specsFromLines, validateLines, type AssetLine,
} from './asset-purchase-calc';

type Mode = 'register' | AssetPurchasePaymentType;
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function AssetPurchasePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();
  const { id } = useParams<{ id: string }>();
  const { company_id, role, permissions } = useAuthStore();
  const canWrite = hasPerm(role, permissions, 'accounting.write');
  const currency = useCompanyCurrency();
  const country = useCompanyCountry();
  const taxName = useTaxName();
  const vatApplies = useVatApplies();

  const [mode, setMode]             = useState<Mode>('credit');
  const [supplierId, setSupplierId] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [date, setDate]             = useState(todayIso());
  const [dueDate, setDueDate]       = useState('');
  const [paidFromId, setPaidFromId] = useState('');
  const [notes, setNotes]           = useState('');
  const [inclusive, setInclusive]   = useState(false);
  const [roundOff, setRoundOff]     = useState('0');
  const [lines, setLines]           = useState<AssetLine[]>([newAssetLine()]);
  const [docNumber, setDocNumber]   = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [dirty, setDirty]           = useState(false);
  const [loadedId, setLoadedId]     = useState<string | null>(null);
  const confirmLeave = useUnsavedChangesGuard(dirty);

  // ── reference data ─────────────────────────────────────────────────────
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'), enabled: !!company_id,
  });
  const { data: coa = [] } = useQuery<CoaRow[]>({
    queryKey: ['coa', company_id], queryFn: () => getAdapter().coa.list(company_id!), enabled: !!company_id,
  });
  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id], queryFn: () => getAdapter().bankAccounts.list(company_id!), enabled: !!company_id,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses', company_id], queryFn: () => getAdapter().warehouses.list(company_id!), enabled: !!company_id,
  });
  const { data: taxRates = [] } = useQuery<TaxRateRow[]>({
    queryKey: ['taxRates', company_id], queryFn: () => getAdapter().taxRates.list(company_id!), enabled: !!company_id,
  });

  // Asset-class GL accounts only: fixed and current assets (the engine refuses others).
  const assetAccounts = useMemo(
    () => (coa as CoaRow[]).filter((c) => c.type === 'asset' && c.is_active).sort((a, b) => a.code.localeCompare(b.code)),
    [coa],
  );
  const stdTaxRate = (() => {
    const target = defaultTaxRate(country);
    const hit = taxRates.find((r) => r.is_active && Number(r.rate) === target);
    return hit ? String(hit.rate) : '0';
  })();
  const taxOptions = [
    { value: '0', label: t('sales.no_tax') },
    ...taxRates.filter((r) => r.is_active && Number(r.rate) > 0).map((r) => ({ value: String(r.rate), label: `${r.name} (${r.rate}%)` })),
  ];
  const payFromOptions = bankAccounts.filter((b) => b.is_active !== false && (mode === 'cash' ? b.account_type === 'cash' : b.account_type !== 'cash'));

  // ── existing purchase ──────────────────────────────────────────────────
  const { data: purchase } = useQuery<FixedAssetPurchaseRow | null>({
    queryKey: ['asset_purchase', id], queryFn: () => getAdapter().fixedAssets.getPurchase(id!), enabled: !!id,
  });
  const { data: linkedAssets = [] } = useQuery({
    queryKey: ['fixed_assets', company_id, 'by_purchase', id],
    queryFn: async () => (await getAdapter().fixedAssets.list(company_id!)).filter((a) => a.purchase_id === id),
    enabled: !!id && !!company_id && purchase?.status === 'posted',
  });

  useEffect(() => {
    if (!purchase || loadedId === purchase.id) return;
    (async () => {
      const specs = new Map(purchase.asset_specs.map((s) => [s.sort_order, s]));
      const toLine = (i: number, base: Partial<AssetLine>): AssetLine => {
        const s = specs.get(i);
        return newAssetLine({
          ...base,
          name: s?.name ?? base.name ?? '',
          asset_tag: s?.asset_tag ?? '', category: s?.category ?? '',
          in_service_date: s?.in_service_date ?? '',
          salvage_value: String(s?.salvage_value ?? 0),
          useful_life_months: String(s?.useful_life_months ?? 60),
          method: s?.method ?? 'straight_line', wdv_rate: String(s?.wdv_rate ?? 0),
        });
      };
      setMode(purchase.payment_type);
      setNotes(purchase.notes ?? '');
      if (purchase.doc_type === 'vendor_bill') {
        const [bill, items] = await Promise.all([
          getAdapter().vendorBills.getById(purchase.doc_id), getAdapter().vendorBills.getItems(purchase.doc_id),
        ]);
        if (bill) {
          setSupplierId(bill.supplier_id); setSupplierRef(bill.supplier_bill_number ?? '');
          setDate(bill.date); setDueDate(bill.due_date ?? ''); setInclusive(!!bill.prices_inclusive);
          setRoundOff(String(Number((bill as { round_off_amount?: number }).round_off_amount ?? 0)));
          setDocNumber(bill.bill_number);
        }
        setLines(items.map((it, i) => toLine(it.sort_order ?? i, {
          name: it.description ?? '', asset_account_id: it.coa_account_id ?? '',
          quantity: String(it.quantity), unit_cost: String(it.unit_cost),
          discount_percent: String(it.discount_percent ?? 0), tax_rate: String(Number(it.tax_rate ?? 0)),
          warehouse_id: (it as { warehouse_id?: string | null }).warehouse_id ?? '',
        })));
      } else {
        const [exp, items] = await Promise.all([
          getAdapter().expenses.getById(purchase.doc_id), getAdapter().expenses.getItems(purchase.doc_id),
        ]);
        if (exp) {
          setSupplierId(exp.supplier_id ?? ''); setSupplierRef(exp.reference ?? '');
          setDate(exp.date); setPaidFromId(exp.paid_from_account_id); setDocNumber(exp.expense_number);
        }
        // Expense lines are stored net of discount; show them as such.
        setLines(items.map((it, i) => toLine(it.sort_order ?? i, {
          name: it.description ?? '', asset_account_id: it.expense_account_id,
          quantity: String(it.quantity || 1), unit_cost: String(Number(it.line_subtotal) / (Number(it.quantity) || 1)),
          discount_percent: '0', tax_rate: String(Number(it.tax_rate ?? 0)),
        })));
      }
      setLoadedId(purchase.id);
      setDirty(false);
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [purchase, loadedId]);

  // New purchase: default the tax once the rates arrive.
  useEffect(() => {
    if (id || dirty) return;
    setLines((ls) => ls.map((l) => (l.tax_rate === '0' ? { ...l, tax_rate: stdTaxRate } : l)));
  }, [stdTaxRate]); // eslint-disable-line react-hooks/exhaustive-deps

  const isPosted = purchase?.status === 'posted';
  const readOnly = isPosted || !canWrite;
  const isRegister = mode === 'register';
  const showTax = !isRegister && vatApplies;
  const effInclusive = !isRegister && inclusive;
  const effRoundOff = mode === 'credit' ? Math.max(-1, Math.min(1, parseFloat(roundOff) || 0)) : 0;
  const totals = purchaseTotals(isRegister ? lines.map((l) => ({ ...l, tax_rate: '0', discount_percent: '0' })) : lines, effInclusive, effRoundOff);
  // Once saved, a purchase cannot jump between a bill and an expense.
  const modeLocked = !!purchase;

  const change = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setDirty(true); };

  function problems(): string | null {
    const errs = validateLines(lines);
    if (errs.length) return errs.map((k) => t(k)).join(' · ');
    if (mode === 'credit' && !supplierId) return t('apOcean.err_supplier');
    if ((mode === 'cash' || mode === 'bank') && !paidFromId) return t('apOcean.err_paid_from');
    if (!date) return t('apOcean.err_date');
    return null;
  }

  // ── save the draft document + purchase record ──────────────────────────
  async function persist(): Promise<string> {
    const why = problems();
    if (why) throw new Error(why);
    const pt = mode as AssetPurchasePaymentType;
    const docType = docTypeFor(pt);
    let docId = purchase?.doc_id ?? null;

    if (docType === 'vendor_bill') {
      const items = billItemsFromLines(lines, effInclusive);
      const row = {
        company_id: company_id!,
        bill_number: docNumber ?? await getAdapter().vendorBills.getNextNumber(company_id!),
        supplier_bill_number: supplierRef.trim() || null, supplier_id: supplierId,
        date, project_id: null, due_date: dueDate || null, reference: null,
        currency, exchange_rate: 1, prices_inclusive: effInclusive,
        subtotal: totals.subtotal, discount_amount: totals.discount, tax_amount: totals.tax,
        ...(effRoundOff !== 0 ? { round_off_amount: effRoundOff } : {}),
        total_amount: totals.total, landed_cost_total: 0, status: 'draft' as const,
        linked_grn_id: null, void_reason: null, voided_at: null, voided_by: null,
        notes: notes.trim() || null,
      };
      type BillCreate = Parameters<ReturnType<typeof getAdapter>['vendorBills']['create']>[0];
      if (docId) await getAdapter().vendorBills.update(docId, row as unknown as BillCreate, items, []);
      else docId = (await getAdapter().vendorBills.create(row as unknown as BillCreate, items, [])).id;
      setDocNumber(row.bill_number);
    } else {
      const items = expenseItemsFromLines(lines, effInclusive);
      const net = items.reduce((s, i) => s + Number((i as unknown as { line_subtotal: number }).line_subtotal), 0);
      const header = {
        company_id: company_id!,
        expense_number: docNumber ?? await getAdapter().expenses.getNextNumber(company_id!),
        date, expense_account_id: lines[0].asset_account_id, paid_from_account_id: paidFromId,
        amount: Math.round(net * 100) / 100, tax_amount: totals.tax, total_amount: totals.total,
        supplier_id: supplierId || null, reference: supplierRef.trim() || null,
        description: notes.trim() || lines.map((l) => l.name.trim()).filter(Boolean).join(', ') || t('apOcean.default_desc'),
        status: 'draft', project_id: null,
      } as unknown as ExpenseInsert;
      docId = await getAdapter().expenses.saveWithItems({ id: docId, header, items });
      setDocNumber((header as unknown as { expense_number: string }).expense_number);
    }

    const specs = specsFromLines(lines);
    if (purchase) {
      await getAdapter().fixedAssets.updatePurchase(purchase.id, { payment_type: pt, asset_specs: specs, notes: notes.trim() || null });
      return purchase.id;
    }
    const created = await getAdapter().fixedAssets.createPurchase({
      company_id: company_id!, payment_type: pt, doc_type: docType, doc_id: docId!,
      asset_specs: specs, notes: notes.trim() || null,
    });
    return created.id;
  }

  // Register only: today's New Asset — write the register rows, post nothing.
  async function registerOnly() {
    const why = validateLines(lines).map((k) => t(k)).join(' · ');
    if (why) throw new Error(why);
    const codeOf = (accId: string) => (coa as CoaRow[]).find((c) => c.id === accId)?.code ?? '';
    for (const l of lines) {
      const cost = lineAssetCost({ ...l, tax_rate: '0', discount_percent: '0' }, false);
      await getAdapter().fixedAssets.create(company_id!, {
        name: l.name.trim(), asset_tag: l.asset_tag.trim() || null, category: l.category.trim() || null,
        acquisition_date: date, in_service_date: l.in_service_date || date,
        cost, salvage_value: Math.min(parseFloat(l.salvage_value) || 0, cost),
        useful_life_months: Math.max(1, parseInt(l.useful_life_months, 10) || 60),
        method: l.method, wdv_rate: parseFloat(l.wdv_rate) || 0,
        asset_account_code: codeOf(l.asset_account_id), accum_dep_account_code: '1790', expense_account_code: '6750',
        notes: notes.trim() || null,
      });
    }
  }

  const refresh = async () => {
    await invalidateBooks();
    qc.invalidateQueries({ queryKey: ['fixed_assets'] });
    qc.invalidateQueries({ queryKey: ['asset_purchases'] });
    qc.invalidateQueries({ queryKey: ['asset_purchase'] });
    qc.invalidateQueries({ queryKey: ['vendor_bills'] });
    qc.invalidateQueries({ queryKey: ['expenses'] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isRegister) { await registerOnly(); return null; }
      return persist();
    },
    onSuccess: async (pid) => {
      setError(null); setDirty(false); await refresh();
      if (pid === null) navigate('/accounting/fixed-assets');
      else if (!id) navigate(`/accounting/fixed-assets/purchase/${pid}`, { replace: true });
    },
    onError: (e: Error) => setError(e.message),
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const pid = await persist();
      return { pid, res: await getAdapter().fixedAssets.postPurchase(pid) };
    },
    onSuccess: async ({ pid }) => {
      setError(null); setDirty(false); setLoadedId(null); await refresh();
      if (!id) navigate(`/accounting/fixed-assets/purchase/${pid}`, { replace: true });
    },
    onError: (e: Error) => setError(e.message),
  });

  const reopenMutation = useMutation({
    mutationFn: () => getAdapter().fixedAssets.reopenPurchase(purchase!.id),
    onSuccess: async () => { setError(null); setLoadedId(null); await refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => getAdapter().fixedAssets.deletePurchaseDraft(purchase!.id),
    onSuccess: async () => { setDirty(false); await refresh(); navigate('/accounting/fixed-assets'); },
    onError: (e: Error) => setError(e.message),
  });

  const busy = saveMutation.isPending || postMutation.isPending || reopenMutation.isPending || deleteMutation.isPending;
  const modes: { key: Mode; icon: typeof Wallet; label: string; hint: string }[] = [
    { key: 'register', icon: ClipboardList, label: t('apOcean.mode_register'), hint: t('apOcean.mode_register_hint') },
    { key: 'credit',   icon: CreditCard,    label: t('apOcean.mode_credit'),   hint: t('apOcean.mode_credit_hint') },
    { key: 'cash',     icon: Wallet,        label: t('apOcean.mode_cash'),     hint: t('apOcean.mode_cash_hint') },
    { key: 'bank',     icon: Landmark,      label: t('apOcean.mode_bank'),     hint: t('apOcean.mode_bank_hint') },
  ];
  const modeAllowed = (m: Mode) => !modeLocked || m === mode
    || (purchase?.doc_type === 'expense' && (m === 'cash' || m === 'bank'));

  return (
    <div className="sb-ocean sb-docx sb-docx-edit" data-testid="asset-purchase-ocean">
      <div className="sb-card sb-doc-bar">
        <div className="sb-doc-bar-id">
          <BackButton to="/accounting/fixed-assets" label={t('fa.title')} confirm={confirmLeave} />
          <h1 className="sb-doc-bar-no">{purchase ? t('apOcean.title_purchase') : t('fa.new_asset')}</h1>
          {docNumber && <bdi dir="ltr" className="sb-acct-code">{docNumber}</bdi>}
          {purchase && <StatusBadge status={purchase.status} />}
        </div>
        {canWrite && (
          <div className="sb-doc-bar-actions">
            {!isPosted && (
              <>
                {purchase && (
                  <Button size="sm" variant="ghost" style={{ color: 'var(--sb-danger)' }} disabled={busy}
                    onClick={() => { if (window.confirm(t('apOcean.confirm_delete'))) deleteMutation.mutate(); }}>
                    <Trash2 size={15} aria-hidden="true" /> {t('apOcean.delete_draft')}
                  </Button>
                )}
                <Button size="sm" disabled={busy} onClick={() => saveMutation.mutate()}>
                  <Save size={15} aria-hidden="true" /> {isRegister ? t('apOcean.save_register') : t('apOcean.save_draft')}
                </Button>
                {!isRegister && (
                  <Button size="sm" variant="primary" disabled={busy}
                    onClick={() => { if (window.confirm(t('apOcean.confirm_post', { amount: `${currency} ${fmt(totals.total)}` }))) postMutation.mutate(); }}>
                    <CircleCheck size={15} aria-hidden="true" /> {t('apOcean.post')}
                  </Button>
                )}
              </>
            )}
            {isPosted && (
              <Button size="sm" variant="ghost" disabled={busy}
                onClick={() => { if (window.confirm(t('apOcean.confirm_reopen'))) reopenMutation.mutate(); }}>
                <Pencil size={15} aria-hidden="true" /> {t('apOcean.reopen')}
              </Button>
            )}
          </div>
        )}
      </div>

      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

      {isPosted && purchase && (
        <div className="sb-alert sb-alert-good sb-ap-posted">
          <CircleCheck size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
          <div>
            <p style={{ margin: 0 }}>{t('apOcean.posted_title', { count: linkedAssets.length })}</p>
            <p style={{ margin: '2px 0 0', fontWeight: 500, fontSize: 13 }}>
              {t('apOcean.posted_doc')}{' '}
              <DocLink type={purchase.doc_type === 'vendor_bill' ? 'vendor_bill' : 'expense'} id={purchase.doc_id} label={docNumber ?? undefined} />
            </p>
          </div>
        </div>
      )}

      {/* How was it acquired? */}
      <div className="sb-card sb-doc-card">
        <h2 className="sb-doc-card-title">{t('apOcean.how_title')}</h2>
        <div className="sb-ap-modes" role="radiogroup" aria-label={t('apOcean.how_title')}>
          {modes.map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={mode === m.key}
              className={`sb-ap-mode ${mode === m.key ? 'is-on' : ''}`}
              disabled={readOnly || !modeAllowed(m.key)}
              onClick={() => { setMode(m.key); setPaidFromId(''); setDirty(true); }}>
              <span className="sb-ap-mode-ico" aria-hidden="true"><m.icon size={18} /></span>
              <span className="sb-ap-mode-txt"><strong>{m.label}</strong><small>{m.hint}</small></span>
            </button>
          ))}
        </div>
        {modeLocked && !isPosted && <p className="sb-form-hint" style={{ margin: '10px 0 0' }}>{t('apOcean.mode_locked')}</p>}
      </div>

      {/* Purchase header */}
      <div className="sb-card sb-form sb-doc-card">
        <h2 className="sb-doc-card-title">{isRegister ? t('apOcean.register_details') : t('apOcean.purchase_details')}</h2>
        <div className="sb-ap-head">
          {!isRegister && (
            <div className="sb-ss-field">
              <label className="sb-flabel">{t('apOcean.supplier')}{mode === 'credit' ? ' *' : ` (${t('apOcean.optional')})`}</label>
              <SearchableSelect
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                value={supplierId} onChange={change(setSupplierId)} disabled={readOnly}
                placeholder={t('banking.select_supplier')} panelWidth={300}
              />
            </div>
          )}
          {!isRegister && (
            <Input label={t('apOcean.supplier_ref')} value={supplierRef} disabled={readOnly}
              onChange={(e) => { setSupplierRef(e.target.value); setDirty(true); }} />
          )}
          <Input label={isRegister ? t('fa.f_acquisition_date') : t('apOcean.purchase_date')} type="date" value={date} disabled={readOnly}
            onChange={(e) => { setDate(e.target.value); setDirty(true); }} />
          {mode === 'credit' && (
            <Input label={t('apOcean.due_date')} type="date" value={dueDate} disabled={readOnly}
              onChange={(e) => { setDueDate(e.target.value); setDirty(true); }} />
          )}
          {(mode === 'cash' || mode === 'bank') && (
            <div>
              <label className="sb-flabel">{mode === 'cash' ? t('apOcean.paid_from_cash') : t('apOcean.paid_from_bank')} *</label>
              <select className="sb-pc-select" value={paidFromId} disabled={readOnly}
                onChange={(e) => { setPaidFromId(e.target.value); setDirty(true); }}>
                <option value="">{t('banking.select_account')}</option>
                {payFromOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {payFromOptions.length === 0 && <p className="sb-form-hint" style={{ margin: '4px 0 0' }}>{t('apOcean.no_pay_accounts')}</p>}
            </div>
          )}
          {!isRegister && (
            <div>
              <label className="sb-flabel">{t('apOcean.currency')}</label>
              <div className="sb-ap-static"><bdi dir="ltr">{currency}</bdi> <span className="sb-fx-name">· {t('apOcean.rate_one')}</span></div>
            </div>
          )}
          <div className="sb-ap-head-wide">
            <Input label={t('apOcean.notes')} value={notes} disabled={readOnly}
              onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
          </div>
        </div>
        {!isRegister && showTax && (
          <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 14, marginTop: 12 }}>
            <input type="checkbox" checked={inclusive} disabled={readOnly} style={{ accentColor: 'var(--sb-primary)' }}
              onChange={(e) => { setInclusive(e.target.checked); setDirty(true); }} />
            {t('apOcean.prices_inclusive', { tax: taxName })}
          </label>
        )}
      </div>

      <AssetPurchaseLines
        lines={lines}
        onChange={(ls) => { setLines(ls); setDirty(true); }}
        accounts={assetAccounts}
        taxOptions={taxOptions}
        warehouses={(warehouses as { id: string; name: string }[])}
        showTax={showTax}
        showWarehouse={mode === 'credit'}
        inclusive={effInclusive}
        readOnly={readOnly}
        defaultTaxRate={stdTaxRate}
      />

      {/* Summary */}
      <div className="sb-ap-bottom">
        <div className="sb-card sb-doc-card sb-ap-explain">
          <h2 className="sb-doc-card-title">{t('apOcean.effect_title')}</h2>
          <p className="sb-info-note" style={{ margin: 0 }}>
            {isRegister ? t('apOcean.effect_register')
              : mode === 'credit' ? t('apOcean.effect_credit', { tax: taxName })
              : t('apOcean.effect_cash', { tax: taxName })}
          </p>
        </div>
        <div className="sb-card sb-doc-card sb-doc-summary">
          <div className="sb-doc-summary-rows">
            {!isRegister && (
              <>
                <div className="flex justify-between text-ink-secondary"><span>{t('apOcean.subtotal')}</span><bdi dir="ltr">{fmt(totals.subtotal)}</bdi></div>
                <div className="flex justify-between text-ink-secondary"><span>{t('apOcean.discount')}</span><bdi dir="ltr">−{fmt(totals.discount)}</bdi></div>
                {showTax && <div className="flex justify-between text-ink-secondary"><span>{taxName}</span><bdi dir="ltr">{fmt(totals.tax)}</bdi></div>}
                {mode === 'credit' && (
                  <div className="flex items-center justify-between text-ink-secondary">
                    <span>{t('apOcean.round_off')}</span>
                    <input className="sb-ap-in text-end" dir="ltr" type="number" step="0.01" min="-1" max="1" style={{ width: 90 }}
                      value={roundOff} disabled={readOnly} aria-label={t('apOcean.round_off')}
                      onChange={(e) => { setRoundOff(e.target.value); setDirty(true); }} />
                  </div>
                )}
              </>
            )}
            <div className="sb-doc-grand">
              <span>{isRegister ? t('apOcean.register_total') : t('apOcean.total')}</span>
              <bdi dir="ltr">{currency} {fmt(totals.total)}</bdi>
            </div>
            {!isRegister && (
              <p className="sb-form-hint" style={{ margin: 0 }}>
                {t('apOcean.asset_cost_note', { amount: `${currency} ${fmt(lines.reduce((s, l) => s + lineAssetCost(l, effInclusive), 0))}` })}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
