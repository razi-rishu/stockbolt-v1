/**
 * StaffQuickCreate — phase129.
 *
 * "+ New salesperson" / "+ New purchaser" from inside a picker. Every person
 * is an employee (one identity shared with Payroll), so this window first
 * looks for an existing employee with that name, code or phone and offers to
 * give them the role; only when nobody matches does it create a new employee.
 *
 * Collects basic identity only. Salary, bank and ID details stay in Payroll,
 * which is admin-only. Nothing here posts to the ledger or creates a login.
 * The server functions (search_staff / assign_staff_role / create_staff)
 * scope to the caller's company and check the role's write permission.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { UserPlus, UserCheck } from 'lucide-react';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { SearchableSelect } from '@/ui/searchable-select';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import type { StaffRole, StaffSearchRow } from '@/data/adapter';

export interface StaffPicked {
  employee_id: string;
  /** Set for the sales role: the id documents store in salesperson_id. */
  salesperson_id: string | null;
  name: string;
}

export interface StaffQuickCreateProps {
  open: boolean;
  role: StaffRole;
  /** Usually the picker's search text. */
  initialName?: string;
  onClose: () => void;
  onPicked: (staff: StaffPicked) => void;
}

/** Wait until typing pauses before searching (AGENTS §13: 300 ms). */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const h = setTimeout(() => setV(value), ms); return () => clearTimeout(h); }, [value, ms]);
  return v;
}

export function StaffQuickCreate({ open, role, initialName = '', onClose, onPicked }: StaffQuickCreateProps) {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();

  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [commission, setCommission] = useState('0');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setName(initialName); setPhone(''); setEmail(''); setCommission('0'); setError(null); }
  }, [open, initialName]);

  const query = useDebounced(name.trim());
  const { data: matches = [], isFetching } = useQuery<StaffSearchRow[]>({
    queryKey: ['staff_search', company_id, query],
    queryFn: () => getAdapter().staff.search(query),
    enabled: open && !!company_id && query.length >= 2,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['salespeople'] });
    qc.invalidateQueries({ queryKey: ['staff'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
  };

  const commissionPct = Math.min(100, Math.max(0, Number(commission) || 0));

  const pickExisting = useMutation({
    mutationFn: async (m: StaffSearchRow): Promise<StaffPicked> => {
      const hasRole = role === 'sales' ? m.has_sales : m.is_purchaser;
      if (hasRole) return { employee_id: m.employee_id, salesperson_id: m.salesperson_id, name: m.name };
      const res = await getAdapter().staff.assignRole(m.employee_id, role, true, role === 'sales' ? commissionPct : null);
      return { employee_id: m.employee_id, salesperson_id: res.salesperson_id, name: m.name };
    },
    onSuccess: (picked) => { refresh(); onPicked(picked); },
    onError: (e: Error) => setError(e.message),
  });

  const create = useMutation({
    mutationFn: async (): Promise<StaffPicked> => {
      if (!name.trim()) throw new Error(t('staff.err_name'));
      const res = await getAdapter().staff.create({
        name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, role,
        commission_pct: role === 'sales' ? commissionPct : 0,
      });
      return { employee_id: res.employee_id, salesperson_id: res.salesperson_id, name: name.trim() };
    },
    onSuccess: (picked) => { refresh(); onPicked(picked); },
    onError: (e: Error) => setError(e.message),
  });

  const busy = pickExisting.isPending || create.isPending;
  const title = role === 'sales' ? t('staff.new_salesperson') : t('staff.new_purchaser');

  return (
    <Modal open={open} onClose={onClose} title={title} width="md">
      <form
        className="sb-ocean sb-modal-form space-y-3"
        onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate(); }}
      >
        <p className="sb-info-note" style={{ fontSize: 13, margin: 0 }}>{t('staff.quick_hint')}</p>

        <Input label={t('staff.f_name')} required autoFocus value={name} onChange={(e) => setName(e.target.value)} />

        {/* Existing employees first — never create the same person twice. */}
        {query.length >= 2 && (matches.length > 0 || isFetching) && (
          <div className="sb-card" style={{ padding: 10 }}>
            <p className="sb-acct-label" style={{ margin: '0 0 6px' }}>{t('staff.existing')}</p>
            {isFetching && matches.length === 0 && <p className="sb-form-hint" style={{ margin: 0 }}>{t('common.loading')}</p>}
            {matches.map((m) => {
              const hasRole = role === 'sales' ? m.has_sales : m.is_purchaser;
              return (
                <div key={m.employee_id} className="flex flex-wrap items-center justify-between gap-2" style={{ padding: '6px 0' }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{m.name}</span>
                    {m.code && <bdi dir="ltr" className="sb-acct-code" style={{ marginInlineStart: 8 }}>{m.code}</bdi>}
                    {!m.is_active && <span className="sb-pill sb-pill-muted" style={{ marginInlineStart: 8 }}>{t('staff.inactive')}</span>}
                  </span>
                  <Button type="button" size="sm" variant="secondary" disabled={busy || !m.is_active}
                    onClick={() => { setError(null); pickExisting.mutate(m); }}>
                    <UserCheck size={15} aria-hidden="true" />{' '}
                    {hasRole ? t('staff.select') : (role === 'sales' ? t('staff.make_salesperson') : t('staff.make_purchaser'))}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label={t('staff.f_phone')} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label={t('staff.f_email')} dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {role === 'sales' && (
            <Input label={t('staff.f_commission')} dir="ltr" type="number" min="0" max="100" step="0.01"
              value={commission} onChange={(e) => setCommission(e.target.value)} />
          )}
        </div>

        {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            <UserPlus size={15} aria-hidden="true" /> {t('staff.create_new')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** May the signed-in user add staff for this role? (The server checks again.) */
export function useCanAddStaff(role: StaffRole): boolean {
  const { role: userRole, permissions } = useAuthStore();
  const can = (p: Parameters<typeof hasPerm>[2]) => hasPerm(userRole, permissions, p);
  return role === 'sales'
    ? can('sales.write') || can('settings.write')
    : can('purchasing.write');
}

export interface StaffPickerProps {
  role: StaffRole;
  /** value = salesperson_id for 'sales', employee_id for 'purchasing'. */
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  panelWidth?: number;
}

/**
 * The staff dropdown used on documents, with "+ Add new …" that opens
 * StaffQuickCreate and selects the person it returns.
 */
export function StaffPicker({ role, options, value, onChange, disabled, placeholder, panelWidth = 280 }: StaffPickerProps) {
  const { t } = useTranslation();
  const canAdd = useCanAddStaff(role);
  const [qcOpen, setQcOpen] = useState(false);
  const [seed, setSeed] = useState('');
  return (
    <>
      <SearchableSelect
        options={options}
        value={value}
        disabled={disabled}
        onChange={onChange}
        placeholder={placeholder}
        panelWidth={panelWidth}
        addNew={!disabled && canAdd ? {
          noun: role === 'sales' ? t('staff.noun_salesperson') : t('staff.noun_purchaser'),
          onClick: (q) => { setSeed(q); setQcOpen(true); },
        } : undefined}
      />
      <StaffQuickCreate
        open={qcOpen}
        role={role}
        initialName={seed}
        onClose={() => setQcOpen(false)}
        onPicked={(p) => {
          setQcOpen(false);
          const id = role === 'sales' ? p.salesperson_id : p.employee_id;
          if (id) onChange(id);
        }}
      />
    </>
  );
}
