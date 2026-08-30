import { AuthForm } from './components/AuthForm';
import { MatchView } from './components/MatchView';
import { useAuth } from './hooks/useAuth';
import { config, configError } from './config';
import styles from './App.module.css';

export default function App() {
  const { session, loading, signOut } = useAuth();

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
    return <div className={styles.booting}>Loading…</div>;
  }

  if (!session) {
    return <AuthForm />;
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <h1 className={styles.brand}>FootyCompanion</h1>
        <div className={styles.account}>
          <span className={styles.email}>{session.user.email}</span>
          <button className={styles.signOut} type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <MatchView matchId={config.matchId} />
      </main>
    </div>
  );
}
