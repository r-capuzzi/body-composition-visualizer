import { useEffect, useState } from "react";

const isPlainObject = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Like useState, but the value is mirrored to localStorage so it survives a
 * page reload. Same API as useState: `const [x, setX] = usePersistentState(key, init)`.
 *
 * Notes:
 *  - The initializer runs ONCE (lazy useState) - it reads storage on mount only.
 *  - If `initialValue` is an object, stored data is merged OVER it, so a field
 *    you add to the defaults later still appears for users with old saved data.
 *  - Every read and write is wrapped: private-mode browsers, disabled storage,
 *    corrupt JSON and quota-exceeded all fall back gracefully instead of
 *    crashing the app.
 */
export function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored == null) return initialValue;
      const parsed = JSON.parse(stored);
      return isPlainObject(initialValue) && isPlainObject(parsed)
        ? { ...initialValue, ...parsed }
        : parsed;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage disabled or full - not worth interrupting the user over
    }
  }, [key, value]);

  return [value, setValue];
}
