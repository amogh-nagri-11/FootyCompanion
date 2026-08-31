import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'fc.theme';

function read(): ThemePref {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // Private browsing or blocked storage — fall through to the OS preference.
  }
  return 'system';
}

/**
 * Theme preference, applied by stamping `data-theme` on <html>. "system" clears
 * the attribute so the `prefers-color-scheme` rules in index.css take over,
 * which is why there is no need to watch the media query here.
 */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(read);

  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);

    try {
      localStorage.setItem(KEY, pref);
    } catch {
      // Preference just won't survive a reload; the UI still works.
    }
  }, [pref]);

  // Cycles system -> light -> dark -> system, so the OS default stays reachable.
  const cycle = useCallback(() => {
    setPref((p) => (p === 'system' ? 'light' : p === 'light' ? 'dark' : 'system'));
  }, []);

  return { pref, setPref, cycle };
}
