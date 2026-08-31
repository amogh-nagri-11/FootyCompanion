import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { api, ApiError } from '../lib/api';
import styles from './ProfileScreen.module.css';

export function DangerZone({ email }: { email?: string | null }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState<'signout' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  const confirmMatches =
    !!email && confirm.trim().toLowerCase() === email.toLowerCase();

  async function signOutEverywhere() {
    setError(null);
    setNotice(null);
    setBusy('signout');
    try {
      // 'global' revokes every refresh token, so other browsers and devices are
      // signed out too — the point of the button.
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) setError(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    setError(null);
    setNotice(null);
    setBusy('delete');
    try {
      await api.del('/profile', { confirm: confirm.trim() });
      setNotice('Account deleted. Signing you out…');
      // The user row is gone; clear the local session so the app does not sit
      // holding a token for an account that no longer exists.
      await supabase.auth.signOut();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the account.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.dangerCard} aria-label="Account actions">
      <h2 className={styles.dangerTitle}>Danger zone</h2>
      <p className={styles.sectionHint}>These actions affect your whole account.</p>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button
          className={styles.ghost}
          type="button"
          onClick={() => void signOutEverywhere()}
          disabled={busy !== null}
        >
          {busy === 'signout' ? 'Signing out…' : 'Sign out on all devices'}
        </button>
      </div>

      <div className={styles.divider} />

      {!armed ? (
        <div className={styles.actions}>
          <button className={styles.danger} type="button" onClick={() => setArmed(true)}>
            Delete account…
          </button>
          <span className={styles.inlineHint}>
            Permanently removes your profile, followed teams and saved matches.
          </span>
        </div>
      ) : (
        <>
          <p className={styles.warning}>
            This cannot be undone. Your profile, followed teams, saved matches and FPL link
            are deleted permanently. Type <strong>{email}</strong> below to confirm.
          </p>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="delete-confirm">
              Confirm your email
            </label>
            <input
              id="delete-confirm"
              className={styles.input}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={email ?? ''}
              autoComplete="off"
            />
          </div>
          <div className={styles.actions}>
            <button
              className={styles.danger}
              type="button"
              onClick={() => void deleteAccount()}
              disabled={!confirmMatches || busy !== null}
            >
              {busy === 'delete' ? 'Deleting…' : 'Permanently delete my account'}
            </button>
            <button
              className={styles.ghost}
              type="button"
              onClick={() => {
                setArmed(false);
                setConfirm('');
                setError(null);
              }}
              disabled={busy !== null}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}
