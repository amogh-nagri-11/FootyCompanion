import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { ProfileContext } from '../lib/profileContext';
import type { Profile } from '../types';

/**
 * One shared copy of the signed-in user's profile. The header and the profile
 * screen both need it, and sharing it means an edit shows up in the header
 * immediately instead of after a page load.
 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    // oxlint-disable-next-line react/set-state-in-effect
    api
      .get<Profile>('/profile')
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load profile');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return (
    <ProfileContext.Provider value={{ profile, loading, error, reload }}>
      {children}
    </ProfileContext.Provider>
  );
}
