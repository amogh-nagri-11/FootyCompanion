import { createContext, useContext } from 'react';
import type { Profile } from '../types';

export interface ProfileContextValue {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export const ProfileContext = createContext<ProfileContextValue>({
  profile: null,
  loading: true,
  error: null,
  reload: () => {},
});

export function useProfile(): ProfileContextValue {
  return useContext(ProfileContext);
}

/** The name to show for a profile: display name, else handle, else email local part. */
export function profileName(profile: Profile | null, fallbackEmail?: string | null): string {
  return (
    profile?.display_name?.trim() ||
    profile?.username?.trim() ||
    (profile?.email ?? fallbackEmail)?.split('@')[0] ||
    'Account'
  );
}
