/**
 * useResolvedPrintTemplate — Phase 15.
 *
 * Resolves the print template a given document type should render with
 * (per-doc-type default → company default → synthetic classic fallback) for
 * the in-app "view-first" document previews. Always returns a usable template
 * so callers can render unconditionally.
 */
import { useEffect, useState } from 'react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { DEFAULT_TEMPLATE_SETTINGS, type PrintTemplate, type PrintDocumentType } from '@/modules/print/engine/types';

function classicFallback(company_id: string): PrintTemplate {
  return {
    id: '', company_id, name: 'Default Template', template_style: 'classic',
    primary_color: '#0F172A', secondary_color: '#475569', accent_color: '#F5C242', text_color: '#0F172A',
    font_family: 'Inter', font_size: 'medium', logo_position: 'left', logo_size: 'medium',
    is_default: true, settings: DEFAULT_TEMPLATE_SETTINGS,
  };
}

export function useResolvedPrintTemplate(documentType: PrintDocumentType): PrintTemplate {
  const company_id = useAuthStore(s => s.company_id);
  const [tpl, setTpl] = useState<PrintTemplate>(() => classicFallback(company_id ?? ''));

  useEffect(() => {
    if (!company_id) return;
    let cancelled = false;
    getAdapter().printTemplates.getResolved(company_id, documentType)
      .then(t => { if (!cancelled) setTpl(t); })
      .catch(() => { /* keep classic fallback */ });
    return () => { cancelled = true; };
  }, [company_id, documentType]);

  return tpl;
}
