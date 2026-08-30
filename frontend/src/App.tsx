import { AuthForm } from './components/AuthForm';
import { MatchView } from './components/MatchView';
import { MatchList } from './components/MatchList';
import { ArchiveScreen } from './components/ArchiveScreen';
import { ArchiveMatchScreen } from './components/ArchiveMatchScreen';
import { FollowingScreen } from './components/FollowingScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { useAuth } from './hooks/useAuth';
import { useRoute, href } from './hooks/useRoute';
import { useUserLists } from './hooks/useUserLists';
import { configError } from './config';
import styles from './App.module.css';

const NAV = [
  { path: '/', label: 'Live' },
  { path: '/saved', label: 'Saved' },
  { path: '/following', label: 'Following' },
  { path: '/archive', label: 'Archive' },
  { path: '/profile', label: 'Profile' },
];

function Routes() {
  const segments = useRoute();
  const { saved, teams, toggleSave, toggleFollow } = useUserLists();
  const [head, param] = segments;

  if (head === 'match' && param) {
    return (
      <MatchView
        matchId={param}
        isSaved={saved.has(param)}
        followedTeams={teams}
        onToggleSave={toggleSave}
        onToggleFollow={toggleFollow}
      />
    );
  }

  if (head === 'archive') {
    return param ? <ArchiveMatchScreen matchId={param} /> : <ArchiveScreen />;
  }

  if (head === 'following') {
    return (
      <FollowingScreen
        teams={teams}
        savedIds={saved}
        onToggleSave={toggleSave}
        onToggleFollow={toggleFollow}
      />
    );
  }

  if (head === 'profile') {
    return <ProfileScreenWithEmail />;
  }

  if (head === 'saved') {
    return (
      <MatchList
        key="saved"
        title="Saved matches"
        emptyMessage="No saved matches are live right now. Saved matches appear here while they are being played."
        onlyMatchIds={saved}
        savedIds={saved}
        onToggleSave={toggleSave}
        followedTeams={teams}
      />
    );
  }

  return (
    <MatchList
      key="live"
      title="Live matches"
      emptyMessage="No matches are in play right now."
      savedIds={saved}
      onToggleSave={toggleSave}
      followedTeams={teams}
    />
  );
}

function ProfileScreenWithEmail() {
  const { session } = useAuth();
  return <ProfileScreen email={session?.user.email} />;
}

export default function App() {
  const { session, loading, signOut } = useAuth();
  const segments = useRoute();
  const current = `/${segments[0] ?? ''}`;

  if (configError) {
    return (
      <div className={styles.fatal}>
        <strong>Configuration missing.</strong> Set <code>{configError}</code> in{' '}
        <code>frontend/.env</code> (see <code>.env.example</code>) and restart the dev
        server.
      </div>
    );
  }

  if (loading) return <div className={styles.booting}>Loading…</div>;
  if (!session) return <AuthForm />;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topRow}>
          <a className={styles.brand} href={href('/')}>
            FootyCompanion
          </a>
          <div className={styles.account}>
            <span className={styles.email}>{session.user.email}</span>
            <button className={styles.signOut} type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>

        <nav className={styles.nav} aria-label="Sections">
          {NAV.map((item) => {
            const active = item.path === '/' ? current === '/' : current === item.path;
            return (
              <a
                key={item.path}
                className={active ? styles.navLinkActive : styles.navLink}
                href={href(item.path)}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </header>

      <main className={styles.main}>
        <Routes />
      </main>
    </div>
  );
}
