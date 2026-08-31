import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import styles from './ProfileScreen.module.css';

export function FplTeamSection() {
  const { data, loading, reload } = useApiResource(
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
      await api.put('/fpl/team', { teamId: Number(draft.trim()) });
      setNotice('FPL team linked. Your points update live during Premier League matches.');
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

  return (
    <section className={styles.card} aria-label="Fantasy Premier League">
      <h2 className={styles.sectionTitle}>Fantasy Premier League</h2>
      <p className={styles.sectionHint}>
        Your team id is the number in your FPL URL — fantasy.premierleague.com/entry/
        <strong>1234567</strong>/event/1
      </p>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}

      {loading ? (
        <p className={styles.sectionHint}>Loading…</p>
      ) : (
        <form className={styles.actions} onSubmit={save}>
          <input
            className={styles.input}
            style={{ flex: 1, minWidth: 160 }}
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
      )}
    </section>
  );
}
