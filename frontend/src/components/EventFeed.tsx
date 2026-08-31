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
  substitution: '⇄',
  other: '•',
};

const TYPE_LABELS: Record<MatchEventType, string> = {
  goal: 'Goal',
  card: 'Card',
  substitution: 'Substitution',
  other: 'Event',
};

const NODE_CLASS: Record<MatchEventType, string> = {
  goal: styles.nodeGoal,
  card: styles.nodeCard,
  substitution: styles.nodeSub,
  other: styles.node,
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
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            ⚽
          </span>
          <p className={styles.emptyTitle}>No events yet</p>
          <p className={styles.emptyText}>
            Goals, cards and substitutions land here the moment they happen.
          </p>
        </div>
      ) : (
        // aria-live so a screen reader announces arrivals the same way the
        // highlight animation flags them visually.
        <ul className={styles.list} aria-live="polite">
          {events.map((event) => {
            const isFresh = freshEventIds.has(event.id);
            const isHome = state ? event.team === state.homeTeam : false;
            const isAway = state ? event.team === state.awayTeam : false;
            const type = ICONS[event.type] ? event.type : 'other';

            return (
              <li
                key={event.id}
                className={`${styles.item} ${isFresh ? styles.fresh : ''} ${
                  type === 'goal' ? styles.itemGoal : ''
                }`}
              >
                <span className={styles.minute}>{event.minute}&apos;</span>

                {/* The node sits on the timeline rail drawn behind the list. */}
                <span className={NODE_CLASS[type]} aria-hidden="true">
                  {ICONS[type]}
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
                    <span className={styles.type}>{TYPE_LABELS[type]}</span>
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
