import { useState, type FormEvent } from 'react';
import type { AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { BallIcon } from './icons';
import styles from './AuthForm.module.css';

type Mode = 'signin' | 'signup';

/**
 * Supabase surfaces most auth failures as one flat message. Translate the ones
 * a user can actually act on; fall back to the raw message otherwise.
 */
function describeError(error: AuthError, mode: Mode): string {
  const raw = error.message.toLowerCase();

  if (raw.includes('invalid login credentials')) {
    return 'That email and password combination is not recognised.';
  }
  if (raw.includes('email not confirmed')) {
    return 'Your email address has not been confirmed yet. Check your inbox for the confirmation link.';
  }
  if (raw.includes('user already registered') || raw.includes('already been registered')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (raw.includes('password should be at least')) {
    return 'Password is too short — use at least 6 characters.';
  }
  if (raw.includes('unable to validate email') || raw.includes('invalid email')) {
    return 'That does not look like a valid email address.';
  }
  if (raw.includes('for security purposes') || error.status === 429) {
    return 'Too many attempts. Wait a moment and try again.';
  }
  if (raw.includes('failed to fetch') || raw.includes('network')) {
    return 'Could not reach the authentication server. Check your connection.';
  }
  return error.message || (mode === 'signin' ? 'Sign in failed.' : 'Sign up failed.');
}

export function AuthForm() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Enter both an email address and a password.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) setError(describeError(error, mode));
        // On success the auth listener swaps this screen out — nothing to do.
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (error) {
          setError(describeError(error, mode));
        } else if (data.user && data.user.identities?.length === 0) {
          // Supabase returns a user with no identities rather than an error
          // when the address is already taken and confirmations are on.
          setError('An account with this email already exists. Try signing in instead.');
        } else if (!data.session) {
          setNotice(
            `Account created. Check ${trimmedEmail} for a confirmation link, then sign in.`
          );
          setPassword('');
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.mark} aria-hidden="true">
          <BallIcon size={24} />
        </span>
        <h1 className={styles.brand}>LiveXI</h1>
        <p className={styles.tagline}>Live scores, events and win probability.</p>

        <div className={styles.tabs} role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            className={styles.tab}
            onClick={() => switchMode('signin')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={styles.tab}
            onClick={() => switchMode('signup')}
          >
            Create account
          </button>
        </div>

        {error && (
          <p className={`${styles.message} ${styles.error}`} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={`${styles.message} ${styles.notice}`} role="status">
            {notice}
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className={styles.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">
              Password
            </label>
            <div className={styles.passwordWrap}>
              <input
                id="password"
                className={styles.input}
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 6 characters' : ''}
              />
              <button
                type="button"
                className={styles.reveal}
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button className={styles.submit} type="submit" disabled={submitting}>
            {submitting
              ? mode === 'signin'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'signin'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        <p className={styles.hint}>
          {mode === 'signin'
            ? 'No account yet? Use “Create account” above.'
            : 'Already registered? Switch to “Sign in”.'}
        </p>
      </div>
    </div>
  );
}
