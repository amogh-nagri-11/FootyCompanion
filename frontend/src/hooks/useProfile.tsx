import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { ProfileContext } from '../lib/profileContext';
import { useAuth } from './useAuth';
import type { Profile } from '../types';

/**
 * One shared copy of the signed-in user's profile. The header and the profile
 * screen both need it, and sharing it means an edit shows up in the header
 * immediately instead of after a page load.
 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  // This provider sits above the sign-in gate, so it mounts while signed out
  // too. It must wait for auth: fetching on mount raced getSession(), failed
  // with "session has expired", and — since nothing re-ran the fetch when the
  // session arrived — left that error on screen for a signed-in user.
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user.id ?? null;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    // Still resolving the session — hold, rather than fetching without a token.
    if (authLoading) return;

    // Signed out: no profile to hold, and no request worth making. Clearing
    // here rather than during render is deliberate — this is reacting to an
    // external auth change, not deriving state from props.
    if (!userId) {
      // oxlint-disable-next-line react/set-state-in-effect
      setProfile(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);

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
    // Re-runs when the user signs in or out, which is the fix.
  }, [userId, authLoading, nonce]);

  return (
    <ProfileContext.Provider value={{ profile, loading, error, reload }}>
      {children}
    </ProfileContext.Provider>
  );
}
