/**
 * KeyboardShortcutProvider — the single global keydown manager (Phase 1).
 *
 * One capture-phase listener on document. Handles:
 *   • Alt + <letter>  → navigate (NAV_MAP)            [ignored while typing]
 *   • Alt + N         → new document for current module [ignored while typing]
 *   • mod + /         → command palette                [works while typing]
 *   • ?               → help modal                     [ignored while typing]
 *   • mod + S / mod + Enter / mod + P / mod + D → run a registered context
 *     action (save/print/duplicate). preventDefault ONLY when an action is
 *     registered, so browser defaults survive on pages that don't opt in.
 *
 * Context actions are registered by editors via useShortcutAction. Esc is left
 * to <Modal> (already handled there) to avoid double-handling.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { NAV_MAP, newDocRouteFor } from './shortcuts';
import { CommandPalette } from './CommandPalette';
import { ShortcutHelpModal } from './ShortcutHelpModal';

export type ShortcutActionId = 'save' | 'print' | 'duplicate' | 'newDoc';

interface ShortcutContextValue {
  registerAction: (id: ShortcutActionId, handler: () => void) => () => void;
  openPalette: () => void;
  openHelp: () => void;
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

export function useShortcutContext(): ShortcutContextValue {
  const ctx = useContext(ShortcutContext);
  if (!ctx) throw new Error('useShortcutContext must be used within KeyboardShortcutProvider');
  return ctx;
}

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}

export function KeyboardShortcutProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const actionsRef = useRef<Map<ShortcutActionId, () => void>>(new Map());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Keep the latest pathname in a ref so the stable listener can read it.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const registerAction = useCallback((id: ShortcutActionId, handler: () => void) => {
    actionsRef.current.set(id, handler);
    return () => {
      if (actionsRef.current.get(id) === handler) actionsRef.current.delete(id);
    };
  }, []);

  const runAction = useCallback((id: ShortcutActionId): boolean => {
    const fn = actionsRef.current.get(id);
    if (fn) { fn(); return true; }
    return false;
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const openHelp = useCallback(() => setHelpOpen(true), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      const typing = isTypingTarget(e.target);

      // ── Command palette: mod + /  or mod + K  (works even while typing) ──
      if (mod && (e.key === '/' || e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setPaletteOpen(p => !p);
        return;
      }

      // ── Document actions (work while typing too) ─────────────────────────
      if (mod && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === 's')      { if (runAction('save'))      e.preventDefault(); return; }
        if (e.key === 'Enter') { if (runAction('save'))   e.preventDefault(); return; }
        if (k === 'p')      { if (runAction('print'))     e.preventDefault(); return; }
        if (k === 'd')      { if (runAction('duplicate')) e.preventDefault(); return; }
      }

      if (typing) return;   // everything below is blocked while typing

      // ── Help: ? (Shift + /) ──────────────────────────────────────────────
      if (e.key === '?') { e.preventDefault(); setHelpOpen(true); return; }

      // ── Navigation: Alt + letter / Alt + N ───────────────────────────────
      if (e.altKey && !mod && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === 'n') {
          const route = newDocRouteFor(pathRef.current);
          if (route) { e.preventDefault(); navigate(route); }
          return;
        }
        const route = NAV_MAP[k];
        if (route) { e.preventDefault(); navigate(route); }
      }
    }

    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [navigate, runAction]);

  return (
    <ShortcutContext.Provider value={{ registerAction, openPalette, openHelp }}>
      {children}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </ShortcutContext.Provider>
  );
}
