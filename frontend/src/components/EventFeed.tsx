import type { MatchEvent, MatchEventType, MatchState } from '../types';
import styles from './EventFeed.module.css';

interface Props {
  events: MatchEvent[];
  freshEventIds: Set<string>;
  state: MatchState | null;
}

const ICONS: Record<MatchEventType, string> = {
  goal: '⚽',
  card: '🟨',
  substitution: '🔁',
  other: '•',
};

const TYPE_LABELS: Record<MatchEventType, string> = {
  goal: 'Goal',
  card: 'Card',
  substitution: 'Substitution',
  other: 'Event',
};

export function EventFeed({ events, freshEventIds, state }: Props) {
  return (
    <section className={styles.card} aria-label="Match events">
      <div className={styles.header}>
        <h2 className={styles.heading}>Match events</h2>
        {events.length > 0 && (
          <span className={styles.count}>
            {events.length} {events.length === 1 ? 'event' : 'events'}
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <p className={styles.empty}>No events yet — they will appear here as they happen.</p>
      ) : (
        // aria-live so a screen reader announces arrivals the same way the
        // highlight animation flags them visually.
        <ul className={styles.list} aria-live="polite">
          {events.map((event) => {
            const isFresh = freshEventIds.has(event.id);
            const isHome = state ? event.team === state.homeTeam : false;
            const isAway = state ? event.team === state.awayTeam : false;

            return (
              <li
                key={event.id}
                className={`${styles.item} ${isFresh ? styles.fresh : ''}`}
              >
                <span className={styles.minute}>{event.minute}&apos;</span>
                <span className={styles.icon} aria-hidden="true">
                  {ICONS[event.type] ?? ICONS.other}
                </span>
                <div className={styles.body}>
                  <div className={styles.detail}>{event.detail}</div>
                  <div className={styles.meta}>
                    <span
                      className={
                        isHome ? styles.homeTeam : isAway ? styles.awayTeam : styles.team
                      }
                    >
                      {event.team}
                    </span>
                    <span className={styles.type}>
                      · {TYPE_LABELS[event.type] ?? TYPE_LABELS.other}
                    </span>
                    {isFresh && <span className={styles.newBadge}>New</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
