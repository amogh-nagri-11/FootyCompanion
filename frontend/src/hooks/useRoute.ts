import { useEffect, useState } from 'react';

/**
 * Hash routing rather than history routing: it needs no server rewrite rules
 * and no router dependency, while still giving every screen a shareable URL.
 */
export function useRoute(): string[] {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/');

  useEffect(() => {
    const onChange = () => setHash(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return hash.split('/').filter(Boolean).map(decodeURIComponent);
}

export function navigate(path: string) {
  window.location.hash = path;
}

export function href(path: string) {
  return `#${path}`;
}
