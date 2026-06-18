/**
 * CommandPaletteTrigger — header button that opens the global search palette,
 * with a visible "Ctrl /" hint for discoverability. Must be rendered inside
 * KeyboardShortcutProvider.
 */
import { useShortcutContext } from './shortcut-registry';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function CommandPaletteTrigger() {
  const { openPalette } = useShortcutContext();
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-label="Open global search"
      aria-keyshortcuts={IS_MAC ? 'Meta+/' : 'Control+/'}
      title={`Search (${IS_MAC ? '⌘' : 'Ctrl'} + /)`}
      className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="7" cy="7" r="4.5" /><path strokeLinecap="round" d="M11 11l3 3" />
      </svg>
      <span className="hidden md:inline">Search</span>
      <kbd className="hidden rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium md:inline">
        {IS_MAC ? '⌘' : 'Ctrl'} /
      </kbd>
    </button>
  );
}
