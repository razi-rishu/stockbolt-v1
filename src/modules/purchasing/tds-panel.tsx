import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { DocLink } from '@/ui/doc-link';
import {
  previewDeduction, indianFinancialYear, type DeducteeType, type TdsSection,
} from '@/lib/tds';
import type { ContactRow, TdsSectionRow, TdsDeductionRow, VendorBillRow } from '@/data/adapter';

/**
 * AC-7B — TDS panel on a confirmed vendor bill (India only).
 *
 * This is the prompt that stops the standalone-deduction design from being a
 * step people forget: it computes the applicable rate from the vendor's PAN /
 * section / §197 certificate, shows the resulting withholding, and posts it
 * with one click. The deduction is its OWN journal entry — confirm_vendor_bill
 * and confirm_vendor_payment are never involved.
 *
 * The preview mirrors src/lib/tds.ts; the RPC recomputes and re-guards the
 * amount server-side, so the posted figure is authoritative.
 */

const MONEY = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface TdsPanelProps {
  bill: VendorBillRow;
  supplier: ContactRow | null;
}

export function TdsPanel({ bill, supplier }: TdsPanelProps) {
  const { t } = useTranslation();
  const { company_id, role, permissions } = useAuthStore();
  const qc = useQueryClient();
  const canWrite = hasPerm(role, permissions, 'accounting.write');

  const [open, setOpen] = useState(false);
  const [sectionCode, setSectionCode] = useState<string>('');
  const [base, setBase] = useState<string>(String(Number(bill.total_amount)));
  const [date, setDate] = useState<string>(bill.date as string);
  const [reverseId, setReverseId] = useState<string | null>(null);

  const { data: sections = [] } = useQuery<TdsSectionRow[]>({
    queryKey: ['tds_sections', company_id],
    queryFn: () => getAdapter().tds.listSections(company_id!),
    enabled: !!company_id,
  });

  const { data: deductions = [] } = useQuery<TdsDeductionRow[]>({
    queryKey: ['tds_deductions_bill', bill.id],
    queryFn: () => getAdapter().tds.listDeductionsForBill(bill.id),
    enabled: !!bill.id,
  });

  const effectiveSectionCode = sectionCode || supplier?.tds_section_code || sections[0]?.code || '';
  const section = sections.find((s) => s.code === effectiveSectionCode) ?? null;

  const fy = indianFinancialYear(date || (bill.date as string));
  const fyFrom = `${fy}-04-01`;
  const fyTo = `${fy + 1}-03-31`;

  const { data: ytdBase = 0 } = useQuery<number>({
    queryKey: ['tds_ytd', company_id, supplier?.id, fyFrom],
    queryFn: () => getAdapter().tds.ytdBaseForContact(company_id!, supplier!.id, fyFrom, fyTo),
    enabled: !!company_id && !!supplier?.id,
  });

  const preview = useMemo(() => {
    if (!section || !supplier) return null;
    const sec: TdsSection = {
      code: section.code,
      rate_individual: Number(section.rate_individual),
      rate_other: Number(section.rate_other),
      single_threshold: Number(section.single_threshold),
      annual_threshold: Number(section.annual_threshold),
    };
    return previewDeduction(
      Number(base) || 0,
      {
        section: sec,
        deductee_type: (supplier.tds_deductee_type as DeducteeType) ?? 'other',
        has_pan: !!(supplier.pan && String(supplier.pan).trim()),
        lower_deduction_rate: supplier.lower_deduction_rate ?? null,
      },
      { base: Number(base) || 0, ytd_base: Number(ytdBase) },
    );
  }, [section, supplier, base, ytdBase]);

  const alreadyDeducted = round2(
    deductions.filter((d) => d.status === 'posted').reduce((a, d) => a + Number(d.amount), 0),
  );
  const roomLeft = round2(Number(bill.total_amount) - alreadyDeducted);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tds_deductions_bill', bill.id] });
    qc.invalidateQueries({ queryKey: ['tds_ytd', company_id, supplier?.id, fyFrom] });
  };

  const recordMutation = useMutation({
    mutationFn: () => getAdapter().tds.record({
      vendor_bill_id: bill.id,
      section_code: effectiveSectionCode,
      base_amount: Number(base),
      rate: preview!.rate,
      deduction_date: date,
      rate_reason: preview!.reason,
    }),
    onSuccess: () => { setOpen(false); invalidate(); },
  });

  const reverseMutation = useMutation({
    mutationFn: () => getAdapter().tds.reverse(reverseId!),
    onSuccess: () => { setReverseId(null); invalidate(); },
  });

  // Nothing to show if the tenant has no TDS sections configured (non-India).
  if (sections.length === 0) return null;

  return (
    <div className="glass-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-primary">{t('tds.panel_title')}</h3>
        {alreadyDeducted > 0 && (
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-600">
            {t('tds.withheld')} {MONEY(alreadyDeducted)}
          </span>
        )}
      </div>

      {/* The prompt — what the vendor's configuration implies for this bill. */}
      {deductions.filter((d) => d.status === 'posted').length === 0 && preview && (
        <p className="mb-2 text-xs text-ink-secondary">
          {preview.applicable
            ? t('tds.prompt', {
                section: effectiveSectionCode,
                rate: preview.rate,
                amount: MONEY(preview.amount),
              })
            : t('tds.prompt_exempt', { section: effectiveSectionCode })}
          {preview.reason === 'no_pan_206aa' && (
            <span className="ms-1 font-medium text-warning-600">{t('tds.no_pan_note')}</span>
          )}
          {preview.reason === 'certificate' && (
            <span className="ms-1 font-medium text-success-600">{t('tds.certificate_note')}</span>
          )}
        </p>
      )}

      {deductions.length > 0 && (
        <table className="mb-2 w-full text-xs">
          <thead className="text-ink-tertiary">
            <tr>
              <th className="py-1 text-start">{t('tds.col_date')}</th>
              <th className="py-1 text-start">{t('tds.col_section')}</th>
              <th className="py-1 text-end">{t('tds.col_rate')}</th>
              <th className="py-1 text-end">{t('tds.col_amount')}</th>
              <th className="py-1 text-start">{t('tds.col_entry')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {deductions.map((d) => (
              <tr key={d.id} className={`border-t border-border-subtle ${d.status === 'reversed' ? 'text-ink-tertiary line-through' : ''}`}>
                <td className="py-1">{d.deduction_date}</td>
                <td className="py-1">{d.section_code}</td>
                <td className="py-1 text-end">{Number(d.rate)}%</td>
                <td className="py-1 text-end">{MONEY(Number(d.amount))}</td>
                <td className="py-1">
                  {d.journal_entry_id
                    ? <DocLink type="journal_entry" id={d.journal_entry_id} status={d.status === 'reversed' ? 'reversed' : 'active'} />
                    : '—'}
                </td>
                <td className="py-1 text-end">
                  {canWrite && d.status === 'posted' && (
                    <button className="text-danger-600 hover:underline" onClick={() => setReverseId(d.id)}>
                      {t('tds.reverse')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canWrite && roomLeft > 0.005 && (
        <Button size="sm" onClick={() => { recordMutation.reset(); setOpen(true); }}>
          {t('tds.deduct')}
        </Button>
      )}

      {/* Deduct modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={t('tds.deduct')} width="md">
        <div className="space-y-3">
          <Select
            label={t('tds.f_section')}
            options={sections.map((s) => ({ value: s.code, label: `${s.code} — ${s.description}` }))}
            value={effectiveSectionCode}
            onChange={(e) => setSectionCode(e.target.value)}
          />
          <Input label={t('tds.f_base')} type="number" step="0.01" value={base} onChange={(e) => setBase(e.target.value)} />
          <Input label={t('tds.f_date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />

          {preview && (
            <div className="rounded-card bg-surface-subtle px-3 py-2 text-xs text-ink-secondary">
              <p>{t('tds.preview_rate', { rate: preview.rate, reason: t(`tds.reason_${preview.reason}`) })}</p>
              <p className="font-medium text-ink-primary">
                {t('tds.preview_amount', { amount: MONEY(preview.amount), net: MONEY(preview.net_payable) })}
              </p>
              {!preview.applicable && <p className="text-warning-600">{preview.exempt_reason}</p>}
              <p className="mt-1 text-ink-tertiary">{t('tds.room_left', { room: MONEY(roomLeft) })}</p>
            </div>
          )}

          {recordMutation.error && <p className="text-xs text-danger-600">{(recordMutation.error as Error).message}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={() => recordMutation.mutate()}
            disabled={recordMutation.isPending || !preview || preview.amount <= 0 || !date}>
            {t('tds.post_deduction')}
          </Button>
        </div>
      </Modal>

      {/* Reverse confirm */}
      <Modal open={!!reverseId} onClose={() => setReverseId(null)} title={t('tds.reverse')} width="md">
        <p className="text-sm text-ink-secondary">{t('tds.reverse_confirm')}</p>
        {reverseMutation.error && <p className="mt-2 text-xs text-danger-600">{(reverseMutation.error as Error).message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setReverseId(null)}>{t('common.cancel')}</Button>
          <Button size="sm" variant="danger" onClick={() => reverseMutation.mutate()} disabled={reverseMutation.isPending}>
            {t('tds.confirm_reverse')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
