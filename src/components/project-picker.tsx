import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useProjectsEnabled } from '@/hooks/use-company-currency';
import { SearchableSelect } from '@/ui/searchable-select';

interface Props {
  /** The document header's project_id; '' for untagged. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /**
   * Skip the built-in <label>. For editors that already wrap their fields in
   * their own labelled container (the expense editor's <Field>), so the field
   * is not labelled twice in two different type styles.
   */
  noLabel?: boolean;
}

/**
 * ProjectPicker — the Project / Job field on a document header (phase104).
 *
 * Renders NOTHING when the tenant has the module switched off. That is the
 * whole point of putting it behind one component: each of the four document
 * editors drops this in unconditionally and the module switch is honoured in
 * one place, instead of four copies of the same `projectsEnabled &&` that drift
 * apart the first time somebody adds a fifth editor.
 *
 * Setting a project here only tags the DOCUMENT. The ledger rows pick the tag
 * up by themselves — the phase105 trigger resolves project_id from the parent
 * document on insert, and carries a later change down to rows already posted.
 * So nothing in these editors needs to know the GL exists.
 */
export function ProjectPicker({ value, onChange, disabled = false, noLabel = false }: Props) {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const projectsEnabled = useProjectsEnabled();

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', company_id],
    queryFn: () => getAdapter().projects.list(company_id!),
    // Shares the cache key with the Projects list page, so opening an editor
    // after visiting that page costs nothing.
    enabled: !!company_id && projectsEnabled,
  });

  if (!projectsEnabled) return null;

  // You can only book NEW work against a job that is still open. A completed
  // or cancelled job stays selectable when it is already on this document,
  // because otherwise reopening an old invoice would show a blank Project and
  // silently clear its tag on the next save.
  const selectable = projects.filter(
    p => p.status === 'planned' || p.status === 'active' || p.id === value,
  );

  return (
    <div>
      {!noLabel && (
        <label className="mb-1 block text-sm font-medium text-ink-primary">
          {t('projects.singular')}
        </label>
      )}
      <SearchableSelect
        options={[
          { value: '', label: t('projects.no_project') },
          ...selectable.map(p => ({ value: p.id, label: p.name })),
        ]}
        value={value}
        disabled={disabled}
        onChange={onChange}
        placeholder={
          projects.length === 0 ? t('projects.none_yet') : t('projects.select')
        }
        panelWidth={280}
      />
    </div>
  );
}
