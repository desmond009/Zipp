import { useEffect, useRef, useState } from 'react';

/**
 * Single-key shortcuts ("1" -> shorten, "n" -> next page). Ignored while the
 * user is typing in a form field or holding a modifier, so they never
 * hijack normal input or browser shortcuts.
 */
export function useKeyboardShortcuts(shortcuts: Record<string, () => void>): void {
  // Read the latest handlers through a ref, so the listener is attached once.
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      latest.current[event.key]?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** The value, but only after it stopped changing for `delayMs` (e.g. search-as-you-type). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
