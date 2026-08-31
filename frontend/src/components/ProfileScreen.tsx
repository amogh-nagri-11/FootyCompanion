import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useProfile } from '../lib/profileContext';
import type { Profile, ProfileFieldsPatch } from '../types';
import { Avatar } from './Avatar';
import { SecuritySection } from './SecuritySection';
import { DangerZone } from './DangerZone';
import { FplTeamSection } from './FplTeamSection';
import styles from './ProfileScreen.module.css';

const BIO_MAX = 300;

function memberSince(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** The name to show: display name if set, else the handle, else the email local part. */
function shownName(profile: Profile): string {
  return (
    profile.display_name?.trim() ||
    profile.username?.trim() ||
    profile.email?.split('@')[0] ||
    'Your profile'
  );
}

export function ProfileScreen({ email }: { email?: string }) {
  // Shared with the header, so a saved display name or avatar shows up there
  // immediately rather than after a reload.
  const { profile: data, loading, error, reload } = useProfile();

  const [form, setForm] = useState<ProfileFieldsPatch>({});
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the form during render rather than in an effect, so the inputs never
  // paint a frame empty. Keyed on the row id so typing is not clobbered.
  if (data && seededFor !== data.id) {
    setSeededFor(data.id);
    setForm({
      username: data.username ?? '',
      displayName: data.display_name ?? '',
      bio: data.bio ?? '',
      avatarUrl: data.avatar_url ?? '',
      favouriteTeam: data.favourite_team ?? '',
    });
  }

  const set = <K extends keyof ProfileFieldsPatch>(key: K, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await api.patch<Profile>('/profile', form);
      const skipped = updated.skipped ?? [];
      setNotice(
        skipped.length > 0
          ? `Saved. ${skipped.join(', ')} could not be stored — the database migration has not been run yet.`
          : 'Profile saved.'
      );
      reload();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={styles.state}>Loading profile…</div>;
  if (error) return <div className={`${styles.state} ${styles.error}`}>{error}</div>;
  if (!data) return null;

  const bioLength = (form.bio ?? '').length;
  const displayEmail = data.email ?? email;

  return (
    <div className={styles.page}>
      <section className={styles.card} aria-label="Your profile">
        <div className={styles.identity}>
          <Avatar name={shownName(data)} url={data.avatar_url} size={64} />
          <div className={styles.identityText}>
            <h1 className={styles.name}>{shownName(data)}</h1>
            <p className={styles.handle}>
              {data.username ? `@${data.username}` : 'No username set'}
              {displayEmail ? ` · ${displayEmail}` : ''}
            </p>
          </div>
        </div>

        {data.bio && <p className={styles.bio}>{data.bio}</p>}

        <div className={styles.metaRow}>
          <span className={styles.metaItem}>
            <span className={styles.metaValue}>{data.stats?.followedTeams ?? 0}</span>
            Teams followed
          </span>
          <span className={styles.metaItem}>
            <span className={styles.metaValue}>{data.stats?.savedMatches ?? 0}</span>
            Matches saved
          </span>
          {data.favourite_team && (
            <span className={styles.metaItem}>
              <span className={styles.metaValue}>{data.favourite_team}</span>
              Favourite club
            </span>
          )}
          <span className={styles.metaItem}>
            <span className={styles.metaValue}>{memberSince(data.created_at)}</span>
            Member since
          </span>
        </div>
      </section>

      {data.migrationPending && (
        <p className={styles.warning}>
          <strong>Database migration pending.</strong> Display name, bio, avatar, favourite
          club and FPL linking cannot be saved until this runs against the Supabase project:
          <code className={styles.code}>db/migrations/001_profile_fields.sql</code>
        </p>
      )}

      <section className={styles.card} aria-label="Edit profile">
        <h2 className={styles.sectionTitle}>Edit profile</h2>
        <p className={styles.sectionHint}>How you appear in the app.</p>

        {notice && <p className={styles.notice}>{notice}</p>}
        {saveError && <p className={styles.error}>{saveError}</p>}

        <form onSubmit={save}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="displayName">
              Display name
            </label>
            <input
              id="displayName"
              className={styles.input}
              value={form.displayName ?? ''}
              onChange={(e) => set('displayName', e.target.value)}
              maxLength={50}
              placeholder="Amogh Bhat Nagri"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className={styles.input}
              value={form.username ?? ''}
              onChange={(e) => set('username', e.target.value)}
              maxLength={30}
              placeholder="amogh"
            />
            <span className={styles.inlineHint}>
              3–30 characters. Letters, numbers, and . _ - only.
            </span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="bio">
              Bio
            </label>
            <textarea
              id="bio"
              className={styles.textarea}
              value={form.bio ?? ''}
              onChange={(e) => set('bio', e.target.value)}
              maxLength={BIO_MAX}
              placeholder="Arsenal supporter. Second screen enthusiast."
            />
            <span className={`${styles.counter} ${bioLength > BIO_MAX ? styles.over : ''}`}>
              {bioLength}/{BIO_MAX}
            </span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="favouriteTeam">
              Favourite club
            </label>
            <input
              id="favouriteTeam"
              className={styles.input}
              value={form.favouriteTeam ?? ''}
              onChange={(e) => set('favouriteTeam', e.target.value)}
              maxLength={60}
              placeholder="Arsenal"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="avatarUrl">
              Avatar image URL
            </label>
            <input
              id="avatarUrl"
              className={styles.input}
              value={form.avatarUrl ?? ''}
              onChange={(e) => set('avatarUrl', e.target.value)}
              placeholder="https://example.com/photo.jpg"
            />
            <span className={styles.inlineHint}>
              Leave empty to use your initials.
            </span>
          </div>

          <button className={styles.primary} type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </section>

      <FplTeamSection />
      <SecuritySection email={displayEmail} />
      <DangerZone email={displayEmail} />
    </div>
  );
}
