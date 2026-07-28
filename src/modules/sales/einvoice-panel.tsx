/**
 * AC-4D — per-invoice e-invoice status panel.
 *
 * On a CONFIRMED sales invoice in a supported jurisdiction (India / UAE), lets
 * the user generate the e-invoice payload (assemble real rows → AC-4B formatter
 * → AC-4C record RPC), view/download it, record the manual government reference
 * (mark submitted), cancel, and see history. Writes go through the sales.write-
 * gated RPCs; nothing here touches the GL.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useHasPermission } from '@/hooks/use-permissions';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { downloadBlob } from '@/lib/io-export';
import { buildCanonicalInvoice, toIndiaGstJson, toPintAeUbl } from '@/lib/einvoice';
import { eInvoiceReadiness } from '@/lib/einvoice-metadata';
import { assembleCanonicalFromInvoice, jurisdictionAndFormat } from '@/lib/einvoice/from-invoice';
import type { InvoiceRow, ContactRow, ProductRow, EInvoiceStatus } from '@/data/adapter';

interface EInvoicePanelProps {
  invoice: InvoiceRow;
  customer: ContactRow | null;
  products: ProductRow[];
}

const STATUS_STYLE: Record<EInvoiceStatus, string> = {
  generated: 'bg-brand-50 text-brand-600',
  submitted: 'bg-success-50 text-success-600',
  cancelled: 'bg-danger-50 text-danger-600',
  superseded: 'bg-surface-subtle text-ink-tertiary',
};

export function EInvoicePanel({ invoice, customer, products }: EInvoicePanelProps) {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const canWrite = useHasPermission('sales.write');
  const qc = useQueryClient();

  const [viewOpen, setViewOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [ref, setRef] = useState({ irn: '', ack_no: '', ack_date: '', qr_data: '' });
  const [cancelReason, setCancelReason] = useState('');

  const { data: company } = useQuery({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });
  const jf = jurisdictionAndFormat(company?.country_code);

  const { data: items = [] } = useQuery({
    queryKey: ['invoice_items_einv', invoice.id],
    queryFn: () => getAdapter().invoices.getItems(invoice.id),
    enabled: jf.supported,
  });
  const { data: doc } = useQuery({
    queryKey: ['einvoice', invoice.id],
    queryFn: () => getAdapter().eInvoices.getForInvoice(invoice.id),
    enabled: jf.supported,
  });
  const { data: history = [] } = useQuery({
    queryKey: ['einvoice_history', invoice.id],
    queryFn: () => getAdapter().eInvoices.listForInvoice(invoice.id),
    enabled: jf.supported && historyOpen,
  });

  const canonicalInput = useMemo(
    () => (company ? assembleCanonicalFromInvoice({ company, invoice, customer, items, products }) : null),
    [company, invoice, customer, items, products],
  );
  const readiness = useMemo(() => {
    if (!canonicalInput) return null;
    return eInvoiceReadiness({
      jurisdiction: jf.jurisdiction,
      is_export: canonicalInput.document.is_export,
      contact: {
        tax_id: canonicalInput.buyer.tax_id,
        place_of_supply_code: canonicalInput.buyer.place_of_supply_code,
        buyer_type: canonicalInput.buyer.buyer_type,
      },
      lines: canonicalInput.lines.map((l) => ({ hsn_code: l.hsn_code, description: l.description })),
    });
  }, [canonicalInput, jf.jurisdiction]);

  function buildPayload(): string {
    const c = buildCanonicalInvoice(canonicalInput!);
    return jf.format === 'india_gst_json' ? JSON.stringify(toIndiaGstJson(c), null, 2) : toPintAeUbl(c);
  }

  const genMutation = useMutation({
    mutationFn: () => getAdapter().eInvoices.record({
      invoice_id: invoice.id, format: jf.format, jurisdiction: jf.jurisdiction, payload: buildPayload(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['einvoice', invoice.id] });
      qc.invalidateQueries({ queryKey: ['einvoice_history', invoice.id] });
    },
  });
  const submitMutation = useMutation({
    mutationFn: () => getAdapter().eInvoices.markSubmitted({
      document_id: doc!.id,
      irn: ref.irn || null, ack_no: ref.ack_no || null,
      ack_date: ref.ack_date || null, qr_data: ref.qr_data || null,
    }),
    onSuccess: () => {
      setSubmitOpen(false);
      qc.invalidateQueries({ queryKey: ['einvoice', invoice.id] });
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () => getAdapter().eInvoices.cancel(doc!.id, cancelReason || undefined),
    onSuccess: () => {
      setCancelOpen(false); setCancelReason('');
      qc.invalidateQueries({ queryKey: ['einvoice', invoice.id] });
      qc.invalidateQueries({ queryKey: ['einvoice_history', invoice.id] });
    },
  });

  function download() {
    if (!doc) return;
    const ext = doc.format === 'india_gst_json' ? 'json' : 'xml';
    const mime = ext === 'json' ? 'application/json' : 'application/xml';
    downloadBlob(doc.payload, `einvoice-${invoice.invoice_number}.${ext}`, mime);
  }

  if (!jf.supported) {
    return (
      <div className="glass-card p-4 text-sm text-ink-tertiary">
        {t('einvoice.title')} — {t('einvoice.unsupported')}
      </div>
    );
  }

  const busy = genMutation.isPending || submitMutation.isPending || cancelMutation.isPending;
  const status = doc?.status;

  return (
    <div className="glass-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-primary">{t('einvoice.title')}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status ? STATUS_STYLE[status] : 'bg-surface-subtle text-ink-tertiary'}`}>
          {t(`einvoice.status_${status ?? 'none'}`)}
        </span>
      </div>

      {/* Readiness — non-blocking hint (warn but allow). */}
      {readiness && !readiness.ready && readiness.missing.length > 0 && (
        <div className="mb-3 rounded-card border border-warning-500/40 bg-warning-50 px-3 py-2 text-xs text-warning-600">
          <p className="mb-1 font-medium">{t('einvoice.readiness_incomplete')}</p>
          <ul className="list-inside list-disc">
            {readiness.missing.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      {(genMutation.error || submitMutation.error || cancelMutation.error) && (
        <p className="mb-2 text-xs text-danger-600">
          {String((genMutation.error || submitMutation.error || cancelMutation.error as Error)?.message ?? '')}
        </p>
      )}

      {doc?.irn && <p className="mb-2 text-xs text-ink-secondary">IRN: <span className="font-mono">{doc.irn}</span></p>}
      {doc?.ack_no && <p className="mb-2 text-xs text-ink-secondary">Ack: <span className="font-mono">{doc.ack_no}</span>{doc.ack_date ? ` · ${doc.ack_date}` : ''}</p>}

      <div className="flex flex-wrap gap-2">
        {(!doc || status === 'cancelled') && canWrite && (
          <Button size="sm" onClick={() => genMutation.mutate()} disabled={busy || !canonicalInput}>
            {t('einvoice.generate')}
          </Button>
        )}
        {doc && status !== 'cancelled' && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setViewOpen(true)}>{t('einvoice.view')}</Button>
            {status === 'generated' && canWrite && (
              <>
                <Button size="sm" variant="secondary" onClick={() => genMutation.mutate()} disabled={busy}>{t('einvoice.regenerate')}</Button>
                <Button size="sm" onClick={() => setSubmitOpen(true)}>{t('einvoice.mark_submitted')}</Button>
              </>
            )}
            {canWrite && <Button size="sm" variant="danger" onClick={() => setCancelOpen(true)}>{t('einvoice.cancel')}</Button>}
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>{t('einvoice.history')}</Button>
      </div>

      {/* View / download payload */}
      <Modal open={viewOpen} onClose={() => setViewOpen(false)} title={t('einvoice.payload_title')} width="xl">
        <pre className="max-h-[60vh] overflow-auto rounded-card bg-surface-subtle p-3 text-xs text-ink-secondary" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {doc?.payload}
        </pre>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={download}>{t('einvoice.download')}</Button>
        </div>
      </Modal>

      {/* Mark submitted — record the manual government reference */}
      <Modal open={submitOpen} onClose={() => setSubmitOpen(false)} title={t('einvoice.mark_submitted')} width="md">
        <div className="space-y-3">
          <p className="text-xs text-ink-tertiary">{t('einvoice.submit_help')}</p>
          <Input label="IRN" value={ref.irn} onChange={(e) => setRef({ ...ref, irn: e.target.value })} />
          <Input label={t('einvoice.ack_no')} value={ref.ack_no} onChange={(e) => setRef({ ...ref, ack_no: e.target.value })} />
          <Input label={t('einvoice.ack_date')} type="date" value={ref.ack_date} onChange={(e) => setRef({ ...ref, ack_date: e.target.value })} />
          <Input label={t('einvoice.qr_data')} value={ref.qr_data} onChange={(e) => setRef({ ...ref, qr_data: e.target.value })} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setSubmitOpen(false)}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>{t('einvoice.confirm_submitted')}</Button>
        </div>
      </Modal>

      {/* Cancel */}
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('einvoice.cancel_title')} width="md">
        <Input label={t('einvoice.cancel_reason')} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setCancelOpen(false)}>{t('common.back')}</Button>
          <Button size="sm" variant="danger" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>{t('einvoice.confirm_cancel')}</Button>
        </div>
      </Modal>

      {/* History */}
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title={t('einvoice.history')} width="lg">
        {history.length === 0 ? (
          <p className="text-sm text-ink-tertiary">{t('einvoice.no_history')}</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-card border border-border-subtle px-3 py-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[h.status]}`}>{t(`einvoice.status_${h.status}`)}</span>
                <span className="text-ink-tertiary">{h.format === 'india_gst_json' ? 'India GST' : 'PINT-AE'} · {new Date(h.generated_at).toLocaleString()}</span>
                {h.irn && <span className="font-mono text-ink-secondary">{h.irn}</span>}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
