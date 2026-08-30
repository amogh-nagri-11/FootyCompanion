import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import type { Profile } from '../types';
import { useApiResource as useResource } from '../hooks/useApiResource';
import styles from './Screens.module.css';

function FplTeamSection() {
  const { data, loading, reload } = useResource(
    () => api.get<{ fplTeamId: number | null }>('/fpl/team'),
    []
  );
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [seeded, setSeeded] = useState(false);
  if (data && !seeded) {
    setSeeded(true);
    setDraft(data.fplTeamId ? String(data.fplTeamId) : '');
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await api.put<{ fplTeamId: number }>('/fpl/team', { teamId: Number(draft.trim()) });
      setNotice('FPL team linked. Your points will update during Premier League matches.');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function unlink() {
    setError(null);
    setNotice(null);
    try {
      await api.del('/fpl/team');
      setDraft('');
      setNotice('FPL team unlinked.');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not unlink.');
    }
  }

  if (loading) return <div className={styles.state}>Loading FPL link…</div>;

  return (
    <>
      <h3 className={styles.title} style={{ fontSize: 15, marginTop: 26 }}>
        Fantasy Premier League
      </h3>
      <p className={styles.subtitle}>
        Your team id is the number in your FPL URL — e.g.{' '}
        <code>fantasy.premierleague.com/entry/</code>
        <strong>1234567</strong>
        <code>/event/1</code>.
      </p>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className={styles.noticeError}>{error}</p>}

      <form className={styles.form} onSubmit={save}>
        <input
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="FPL team id"
          inputMode="numeric"
          aria-label="FPL team id"
        />
        <button className={styles.primary} type="submit" disabled={saving || !draft.trim()}>
          {saving ? 'Checking…' : data?.fplTeamId ? 'Update' : 'Link team'}
        </button>
        {data?.fplTeamId != null && (
          <button className={styles.ghost} type="button" onClick={() => void unlink()}>
            Unlink
          </button>
        )}
      </form>
    </>
  );
}

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

      <FplTeamSection />
    </>
  );
}
