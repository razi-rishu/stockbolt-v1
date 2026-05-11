import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useQuery as useCompanyQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Modal } from '@/ui/modal';
import { Table, type Column } from '@/ui/table';
import { Badge } from '@/ui/badge';
import { Pagination, paginate } from '@/ui/pagination';
import type { ContactRow } from '@/data/adapter';

const PAGE_SIZE = 50;

const schema = z.object({
  name:                 z.string().min(1, 'Required'),
  name_ar:              z.string(),
  type:                 z.enum(['customer', 'supplier', 'both']),
  email:                z.string().email('Invalid email').or(z.literal('')),
  phone:                z.string(),
  mobile:               z.string(),
  currency:             z.string().min(3),
  tax_id:               z.string(),
  address_street:       z.string(),
  address_city:         z.string(),
  address_country:      z.string(),
  contact_person_name:  z.string(),
  contact_person_phone: z.string(),
  credit_limit:         z.coerce.number().min(0),
  payment_terms_days:   z.coerce.number().min(0),
  notes:                z.string(),
});
type FormValues = z.infer<typeof schema>;

interface ContactListPageProps {
  defaultType: 'customer' | 'supplier';
  titleKey: string;
  singularKey: string;
}

export function ContactListPage({ defaultType, titleKey, singularKey }: ContactListPageProps) {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Path used by the Name link in the table — supports both customer and supplier flavours
  const detailBase = defaultType === 'supplier' ? '/contacts/suppliers' : '/contacts/customers';

  const { data: company } = useCompanyQuery({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['contacts', company_id, defaultType],
    queryFn: () => getAdapter().contacts.list(company_id!, defaultType),
    enabled: !!company_id,
  });

  const defaultCurrency = company?.currency ?? 'AED';

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: { name: '', name_ar: '', type: defaultType, email: '', phone: '', mobile: '', currency: defaultCurrency, tax_id: '', address_street: '', address_city: '', address_country: '', contact_person_name: '', contact_person_phone: '', credit_limit: 0, payment_terms_days: 0, notes: '' },
  });

  function openAdd() {
    setEditing(null);
    reset({ name: '', name_ar: '', type: defaultType, email: '', phone: '', mobile: '', currency: defaultCurrency, tax_id: '', address_street: '', address_city: '', address_country: '', contact_person_name: '', contact_person_phone: '', credit_limit: 0, payment_terms_days: 0, notes: '' });
    setOpen(true);
  }

  function openEdit(row: ContactRow) {
    setEditing(row);
    reset({
      name: row.name, name_ar: row.name_ar ?? '', type: row.type as 'customer' | 'supplier' | 'both',
      email: row.email ?? '', phone: row.phone ?? '', mobile: row.mobile ?? '',
      currency: row.currency, tax_id: row.tax_id ?? '',
      address_street: row.address_street ?? '', address_city: row.address_city ?? '', address_country: row.address_country ?? '',
      contact_person_name: row.contact_person_name ?? '', contact_person_phone: row.contact_person_phone ?? '',
      credit_limit: row.credit_limit, payment_terms_days: row.payment_terms_days, notes: row.notes ?? '',
    });
    setOpen(true);
  }

  // Auto-open the edit modal when the page is reached with ?edit=<contact_id>
  // (used by the Edit button on the customer/supplier detail page).
  const editId = searchParams.get('edit');
  useEffect(() => {
    if (!editId || contacts.length === 0) return;
    const row = contacts.find((c) => c.id === editId);
    if (row) {
      openEdit(row);
      // Clear the param so refreshing the page doesn't keep re-opening the modal
      const next = new URLSearchParams(searchParams);
      next.delete('edit');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, contacts]);

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const row = {
        company_id: company_id!,
        name: values.name, name_ar: values.name_ar || null,
        type: values.type, email: values.email || null, phone: values.phone || null, mobile: values.mobile || null,
        currency: values.currency, tax_id: values.tax_id || null,
        address_street: values.address_street || null, address_city: values.address_city || null, address_country: values.address_country || null,
        billing_address_ar: null,
        contact_person_name: values.contact_person_name || null, contact_person_phone: values.contact_person_phone || null,
        contact_person_email: null,
        credit_limit: values.credit_limit, payment_terms_days: values.payment_terms_days,
        notes: values.notes || null, is_active: true,
        address_state: null, address_postal: null, default_price_level_id: null,
      };
      if (editing) await getAdapter().contacts.update(editing.id, row);
      else await getAdapter().contacts.create(row);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacts', company_id, defaultType] }); setOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => getAdapter().contacts.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', company_id, defaultType] }),
  });

  const filtered = contacts.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.name_ar ?? '').includes(search) ||
    (c.email ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.phone ?? '').includes(search),
  );
  const pagedContacts = paginate(filtered, page, PAGE_SIZE);

  const typeBadge = (type: string) => {
    if (type === 'both') return <Badge variant="brand">{t('contacts.type_both')}</Badge>;
    return null;
  };

  const columns: Column<ContactRow>[] = [
    {
      key: 'name',
      header: t('contacts.name'),
      render: (r) => (
        <div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); navigate(`${detailBase}/${r.id}`); }}
            className="font-medium text-brand-600 hover:text-brand-700 hover:underline"
          >
            {r.name}
          </button>
          {typeBadge(r.type) && <span className="ms-2">{typeBadge(r.type)}</span>}
        </div>
      ),
    },
    { key: 'name_ar', header: t('contacts.name_ar'), render: (r) => <span dir="rtl">{r.name_ar ?? '—'}</span> },
    { key: 'phone', header: t('contacts.phone'), render: (r) => r.phone ?? r.mobile ?? '—' },
    { key: 'email', header: t('contacts.email'), render: (r) => r.email ?? '—' },
    { key: 'terms', header: t('contacts.payment_terms'), render: (r) => r.payment_terms_days > 0 ? `Net ${r.payment_terms_days}` : t('contacts.cod') },
    { key: 'city', header: t('contacts.city'), render: (r) => r.address_city ?? '—' },
    {
      key: 'actions', header: '', width: '100px',
      render: (r) => (
        <div className="flex gap-2">
          <button onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="text-xs text-brand-600 hover:underline">{t('common.edit')}</button>
          <button onClick={(e) => { e.stopPropagation(); if (confirm(t('common.confirm_delete'))) deleteMutation.mutate(r.id); }} className="text-xs text-danger-500 hover:underline">{t('common.delete')}</button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink-primary">{t(titleKey)}</h1>
        <Button size="sm" onClick={openAdd}>{t('common.add')} {t(singularKey)}</Button>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        placeholder={t('contacts.search_placeholder')}
        className="h-10 w-full max-w-sm rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />

      {isLoading
        ? <div className="py-12 text-center text-ink-tertiary">{t('common.loading')}</div>
        : (
          <>
            <Table columns={columns} rows={pagedContacts} keyFn={(r) => r.id} emptyMessage={t('contacts.empty')} />
            <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
          </>
        )
      }

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('contacts.edit') : `${t('common.add')} ${t(singularKey)}`} width="xl">
        <form onSubmit={handleSubmit((v) => saveMutation.mutateAsync(v as FormValues))} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('contacts.name')} required error={errors.name?.message} {...register('name')} />
            <Input label={t('contacts.name_ar')} dir="rtl" {...register('name_ar')} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink-primary">{t('contacts.type')}</label>
            <select className="h-10 rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none" {...register('type')}>
              <option value="customer">{t('contacts.type_customer')}</option>
              <option value="supplier">{t('contacts.type_supplier')}</option>
              <option value="both">{t('contacts.type_both')}</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label={t('contacts.email')} type="email" error={errors.email?.message} {...register('email')} />
            <Input label={t('contacts.phone')} {...register('phone')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('contacts.mobile')} {...register('mobile')} />
            <Input label={t('contacts.currency')} required {...register('currency')} />
          </div>
          <Input label={t('contacts.tax_id')} {...register('tax_id')} />

          <div className="border-t border-border-subtle pt-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-tertiary">{t('contacts.address')}</p>
            <div className="grid grid-cols-2 gap-4">
              <Input label={t('contacts.address_street')} {...register('address_street')} />
              <Input label={t('contacts.address_city')} {...register('address_city')} />
            </div>
            <Input label={t('contacts.address_country')} className="mt-4" {...register('address_country')} />
          </div>

          <div className="border-t border-border-subtle pt-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-tertiary">{t('contacts.contact_person')}</p>
            <div className="grid grid-cols-2 gap-4">
              <Input label={t('contacts.contact_person_name')} {...register('contact_person_name')} />
              <Input label={t('contacts.contact_person_phone')} {...register('contact_person_phone')} />
            </div>
          </div>

          <div className="border-t border-border-subtle pt-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-tertiary">{t('contacts.financial')}</p>
            <div className="grid grid-cols-2 gap-4">
              <Input label={t('contacts.credit_limit')} type="number" step="0.01" {...register('credit_limit')} />
              <Input label={t('contacts.payment_terms_days')} type="number" {...register('payment_terms_days')} />
            </div>
          </div>

          {saveMutation.error && <p className="text-xs text-danger-500">{String(saveMutation.error)}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
