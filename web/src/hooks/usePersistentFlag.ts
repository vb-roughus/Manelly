import { useCallback, useState } from 'react';

/** A boolean remembered in this browser, e.g. whether a panel is open. */
export function usePersistentFlag(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === '1';
    } catch {
      // Storage can be unavailable (private mode, blocked cookies).
      return initial;
    }
  });

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // Not remembered, still applied for this visit.
      }
    },
    [key],
  );

  return [value, update] as const;
}
