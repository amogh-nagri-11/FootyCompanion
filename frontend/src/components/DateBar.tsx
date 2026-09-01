import { useMemo } from 'react';
import { ChevronLeftIcon } from './icons';
import styles from './DateBar.module.css';

interface Props {
  /** Selected day, YYYY-MM-DD (UTC, the calendar the fixture feed uses). */
  date: string;
  onChange: (date: string) => void;
  /** Inclusive range the API plan allows; arrows stop at its edges. */
  window: { from: string; to: string } | null;
}

/** Today in UTC, matching how the backend picks its default. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Day picker for the fixture list.
 *
 * The strip only offers days the plan can actually serve — walking into a date
 * the API will refuse is a dead end, so those arrows are disabled rather than
 * left to fail. With a wider plan the window grows and so does the strip.
 */
export function DateBar({ date, onChange, window }: Props) {
  const today = todayUtc();

  const days = useMemo(() => {
    if (!window) return [date];
    const out: string[] = [];
    for (let d = window.from; d <= window.to; d = shiftDate(d, 1)) {
      out.push(d);
      if (out.length > 31) break; // Guard against a bad window from the server.
    }
    return out;
  }, [window, date]);

  const canGoBack = !window || date > window.from;
  const canGoForward = !window || date < window.to;

  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={styles.arrow}
        onClick={() => onChange(shiftDate(date, -1))}
        disabled={!canGoBack}
        aria-label="Previous day"
      >
        <ChevronLeftIcon size={16} />
      </button>

      <div className={styles.days} role="tablist" aria-label="Fixture date">
        {days.map((day) => (
          <button
            key={day}
            type="button"
            role="tab"
            aria-selected={day === date}
            className={`${styles.day} ${day === date ? styles.dayActive : ''}`}
            onClick={() => onChange(day)}
          >
            <span className={styles.dayName}>{labelFor(day, today)}</span>
            <span className={styles.dayDate}>{shortDate(day)}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`${styles.arrow} ${styles.arrowRight}`}
        onClick={() => onChange(shiftDate(date, 1))}
        disabled={!canGoForward}
        aria-label="Next day"
      >
        <ChevronLeftIcon size={16} />
      </button>

      {date !== today && (
        <button type="button" className={styles.today} onClick={() => onChange(today)}>
          Today
        </button>
      )}
    </div>
  );
}

function labelFor(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === shiftDate(today, -1)) return 'Yesterday';
  if (day === shiftDate(today, 1)) return 'Tomorrow';
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
