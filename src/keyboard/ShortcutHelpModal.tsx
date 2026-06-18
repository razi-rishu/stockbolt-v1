/**
 * ShortcutHelpModal — grouped keyboard reference (opened with `?`).
 * Built on the shared <Modal>; RTL-safe (logical layout, no left/right).
 */
import { Modal } from '@/ui/modal';
import { SHORTCUT_GROUPS } from './shortcuts';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

function Keys({ keys }: { keys: string }) {
  const parts = keys.replace(/\bmod\b/g, MOD).split(' + ');
  return (
    <span className="flex items-center gap-1">
      {parts.map((p, i) => (
        <kbd key={i} className="rounded border border-border-subtle bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-secondary shadow-sm">
          {p}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutHelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" width="xl">
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2" aria-label="Keyboard shortcuts">
        {SHORTCUT_GROUPS.map(group => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">{group.title}</h3>
            <ul className="flex flex-col gap-1.5">
              {group.items.map((item, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink-primary">{item.label}</span>
                  <Keys keys={item.keys} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
