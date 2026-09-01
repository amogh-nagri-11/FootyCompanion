import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark';

const KEY = 'fc.theme';

function read(): ThemePref {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    // 'system' is what earlier builds stored. Those readers had never chosen
    // dark explicitly, so land them on the default rather than the OS setting.
  } catch {
    // Private browsing or blocked storage — fall through to the default.
  }
  return 'light';
}

/**
 * Theme preference, applied by stamping `data-theme` on <html>.
 *
 * Light is the product's theme and dark is the alternative a reader opts into,
 * so this deliberately does not follow `prefers-color-scheme`: someone whose
 * OS is dark still gets the paper design until they ask for the other one.
 */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(read);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', pref);

    try {
      localStorage.setItem(KEY, pref);
    } catch {
      // Preference just won't survive a reload; the UI still works.
    }
  }, [pref]);

  const cycle = useCallback(() => {
    setPref((p) => (p === 'light' ? 'dark' : 'light'));
  }, []);

  return { pref, setPref, cycle };
}
