import { useState, type FormEvent } from 'react';
import type { AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import styles from './ProfileScreen.module.css';

const MIN_PASSWORD = 6;

function describe(error: AuthError): string {
  const raw = error.message.toLowerCase();
  if (raw.includes('invalid login credentials')) return 'That password is not correct.';
  if (raw.includes('should be different')) return 'The new password must be different from your current one.';
  if (raw.includes('password should be at least')) {
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  }
  if (raw.includes('for security purposes') || error.status === 429) {
    return 'Too many attempts. Wait a moment and try again.';
  }
  if (raw.includes('email address') && raw.includes('invalid')) {
    return 'That does not look like a valid email address.';
  }
  return error.message;
}

export function SecuritySection({ email }: { email?: string | null }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordMessage(null);
    setPasswordError(null);

    if (next.length < MIN_PASSWORD) {
      setPasswordError(`New password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (next !== confirm) {
      setPasswordError('The two new passwords do not match.');
      return;
    }
    if (!email) {
      setPasswordError('Cannot change the password without a known email address.');
      return;
    }

    setSavingPassword(true);
    try {
      // Re-authenticate first. An open session alone is enough for Supabase to
      // accept a password change, which would let anyone with a borrowed tab
      // lock the owner out.
      const { error: reauth } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (reauth) {
        setPasswordError(describe(reauth));
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) {
        setPasswordError(describe(error));
        return;
      }

      setPasswordMessage('Password updated.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } finally {
      setSavingPassword(false);
    }
  }

  async function changeEmail(e: FormEvent) {
    e.preventDefault();
    setEmailMessage(null);
    setEmailError(null);

    const target = newEmail.trim();
    if (!target) return;
    if (target.toLowerCase() === (email ?? '').toLowerCase()) {
      setEmailError('That is already your email address.');
      return;
    }

    setSavingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: target });
      if (error) {
        setEmailError(describe(error));
        return;
      }
      // Supabase does not switch the address until the link is clicked.
      setEmailMessage(
        `Confirmation sent to ${target}. Your address changes once you click the link in that email.`
      );
      setNewEmail('');
    } finally {
      setSavingEmail(false);
    }
  }

  return (
    <section className={styles.card} aria-label="Security">
      <h2 className={styles.sectionTitle}>Security</h2>
      <p className={styles.sectionHint}>Change your password or the email you sign in with.</p>

      {passwordMessage && <p className={styles.notice}>{passwordMessage}</p>}
      {passwordError && <p className={styles.error}>{passwordError}</p>}

      <form onSubmit={changePassword}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="current-password">
            Current password
          </label>
          <input
            id="current-password"
            className={styles.input}
            type={reveal ? 'text' : 'password'}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            className={styles.input}
            type={reveal ? 'text' : 'password'}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder={`At least ${MIN_PASSWORD} characters`}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="confirm-password">
            Confirm new password
          </label>
          <input
            id="confirm-password"
            className={styles.input}
            type={reveal ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <div className={styles.actions}>
          <button
            className={styles.primary}
            type="submit"
            disabled={savingPassword || !current || !next || !confirm}
          >
            {savingPassword ? 'Updating…' : 'Update password'}
          </button>
          <button
            className={styles.ghost}
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-pressed={reveal}
          >
            {reveal ? 'Hide passwords' : 'Show passwords'}
          </button>
        </div>
      </form>

      <div className={styles.divider} />

      {emailMessage && <p className={styles.notice}>{emailMessage}</p>}
      {emailError && <p className={styles.error}>{emailError}</p>}

      <form onSubmit={changeEmail}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-email">
            Email address
          </label>
          <input
            id="new-email"
            className={styles.input}
            type="email"
            autoComplete="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder={email ?? 'you@example.com'}
          />
          <span className={styles.inlineHint}>
            Currently {email ?? 'unknown'}. Changing it requires confirming the new address.
          </span>
        </div>

        <button
          className={styles.primary}
          type="submit"
          disabled={savingEmail || !newEmail.trim()}
        >
          {savingEmail ? 'Sending…' : 'Change email'}
        </button>
      </form>
    </section>
  );
}
