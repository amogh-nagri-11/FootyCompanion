import type { ReactNode } from 'react';
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
import { useTheme } from './hooks/useTheme';
import { ProfileProvider } from './hooks/useProfile';
import { useProfile, profileName } from './lib/profileContext';
import { Avatar } from './components/Avatar';
import {
  ArchiveIcon,
  AutoThemeIcon,
  BallIcon,
  HeartIcon,
  LiveIcon,
  MoonIcon,
  StarIcon,
  SunIcon,
  UserIcon,
} from './components/icons';
import { configError } from './config';
import styles from './App.module.css';

const NAV: { path: string; label: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { path: '/', label: 'Live', icon: LiveIcon },
  { path: '/saved', label: 'Saved', icon: (p) => <StarIcon {...p} /> },
  { path: '/following', label: 'Following', icon: HeartIcon },
  { path: '/archive', label: 'Archive', icon: ArchiveIcon },
  { path: '/profile', label: 'Profile', icon: UserIcon },
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

/** Avatar and name in the header, linking to the profile screen. */
function AccountChip({ email }: { email?: string }) {
  const { profile } = useProfile();
  const name = profileName(profile, email);

  return (
    <a className={styles.accountLink} href={href('/profile')} title={email}>
      <Avatar name={name} url={profile?.avatar_url} size={26} />
      <span className={styles.email}>{name}</span>
    </a>
  );
}

const THEME_LABEL = {
  system: 'Theme: follows your system',
  light: 'Theme: light',
  dark: 'Theme: dark',
} as const;

function ThemeToggle() {
  const { pref, cycle } = useTheme();
  const Icon = pref === 'light' ? SunIcon : pref === 'dark' ? MoonIcon : AutoThemeIcon;

  return (
    <button
      className={styles.iconBtn}
      type="button"
      onClick={cycle}
      title={`${THEME_LABEL[pref]} — click to change`}
      aria-label={THEME_LABEL[pref]}
    >
      <Icon size={17} />
    </button>
  );
}

function AppShell() {
  const { session, loading, signOut } = useAuth();
  const segments = useRoute();
  const current = `/${segments[0] ?? ''}`;
  // The match screen is reached from Live, so keep that tab lit while reading it.
  const activePath = segments[0] === 'match' ? '/' : current;

  if (configError) {
    return (
      <div className={styles.fatal}>
        <strong>Configuration missing.</strong> Set <code>{configError}</code> in{' '}
        <code>frontend/.env</code> (see <code>.env.example</code>) and restart the dev
        server.
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.booting}>
        <span className={styles.bootMark} aria-hidden="true">
          <BallIcon size={24} />
        </span>
        <span>Loading…</span>
      </div>
    );
  }

  if (!session) return <AuthForm />;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topRow}>
          <a className={styles.brand} href={href('/')}>
            <span className={styles.brandMark} aria-hidden="true">
              <BallIcon size={17} />
            </span>
            <span className={styles.brandName}>FootyCompanion</span>
          </a>

          <nav className={styles.nav} aria-label="Sections">
            {NAV.map((item) => {
              const active = item.path === '/' ? activePath === '/' : activePath === item.path;
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

          <div className={styles.account}>
            <ThemeToggle />
            <AccountChip email={session.user.email} />
            <button className={styles.signOut} type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <Routes />
      </main>

      {/* Phones get a thumb-reachable tab bar instead of the header nav, which
          is hidden below 720px. */}
      <nav className={styles.tabbar} aria-label="Sections">
        {NAV.map((item) => {
          const active = item.path === '/' ? activePath === '/' : activePath === item.path;
          const Icon = item.icon;
          return (
            <a
              key={item.path}
              className={active ? styles.tabActive : styles.tab}
              href={href(item.path)}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={21} />
              <span className={styles.tabLabel}>{item.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ProfileProvider>
      <AppShell />
    </ProfileProvider>
  );
}
