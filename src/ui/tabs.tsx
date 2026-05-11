/**
 * Tabs — minimal tab bar primitive.
 *
 * Controlled component: the parent owns the active tab id. Renders a
 * horizontal pill bar with an underlined active state; the parent is
 * responsible for swapping the panel content based on the active id.
 *
 * Usage:
 *   const [tab, setTab] = useState<'overview' | 'docs' | 'stmt'>('overview');
 *   <Tabs
 *     value={tab}
 *     onChange={(v) => setTab(v as typeof tab)}
 *     items={[
 *       { value: 'overview', label: 'Overview' },
 *       { value: 'docs',     label: 'Documents', badge: 12 },
 *       { value: 'stmt',     label: 'Statement' },
 *     ]}
 *   />
 *   {tab === 'overview' && <OverviewPanel />}
 *   {tab === 'docs'     && <DocsPanel />}
 *   {tab === 'stmt'     && <StatementPanel />}
 */

export interface TabItem {
  value: string;
  label: string;
  /** Optional count shown as a small pill next to the label */
  badge?: number | string;
}

interface TabsProps {
  value: string;
  onChange: (value: string) => void;
  items: TabItem[];
  className?: string;
}

export function Tabs({ value, onChange, items, className = '' }: TabsProps) {
  return (
    <div className={`border-b border-border-subtle ${className}`}>
      <div className="-mb-px flex flex-wrap gap-1">
        {items.map((item) => {
          const active = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'border-brand-500 text-brand-700'
                  : 'border-transparent text-ink-secondary hover:text-ink-primary'
              }`}
            >
              {item.label}
              {item.badge !== undefined && item.badge !== 0 && (
                <span className={`rounded-pill px-1.5 py-0.5 text-[10px] font-semibold ${
                  active ? 'bg-brand-100 text-brand-700' : 'bg-surface-muted text-ink-tertiary'
                }`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
