import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import type { Profile } from '../types';
import styles from './Screens.module.css';

export function ProfileScreen({ email }: { email?: string }) {
  const { data, loading, error } = useApiResource(() => api.get<Profile>('/profile'), []);
  const [username, setUsername] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the field from the loaded profile during render rather than in an
  // effect, so it never renders a frame with an empty box. Keyed on the id so
  // typing is not clobbered on every re-render.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (data && seededFor !== data.id) {
    setSeededFor(data.id);
    setUsername(data.username ?? '');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await api.patch<Profile>('/profile', { username: username.trim() });
      setUsername(updated.username ?? '');
      setNotice('Username updated.');
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={styles.state}>Loading profile…</div>;
  if (error) return <div className={`${styles.state} ${styles.error}`}>{error}</div>;

  return (
    <>
      <h2 className={styles.title}>Profile</h2>
      <p className={styles.subtitle}>Signed in as {email}.</p>

      {notice && <p className={styles.notice}>{notice}</p>}
      {saveError && <p className={styles.noticeError}>{saveError}</p>}

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          maxLength={40}
          aria-label="Username"
        />
        <button className={styles.primary} type="submit" disabled={saving || !username.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </>
  );
}
