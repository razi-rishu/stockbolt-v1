/**
 * useDocumentPayments — the verified money movements behind one document
 * (documentPayments.list). Feed the result to withPaymentDetails() to give a
 * document view, printout or PDF its "Payment details" section.
 *
 * Read-only and RLS-scoped. Returns undefined until loaded, which
 * withPaymentDetails treats as "leave the document as it is".
 */
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import type { DocumentPaymentLine, PaymentTraceDocType } from '@/data/adapter';

export function useDocumentPayments(doc_type: PaymentTraceDocType, doc_id: string | null | undefined, enabled = true) {
  const { data } = useQuery<DocumentPaymentLine[]>({
    queryKey: ['document_payments', doc_type, doc_id],
    queryFn:  () => getAdapter().documentPayments.list(doc_type, doc_id!),
    enabled:  enabled && !!doc_id,
  });
  return data;
}
