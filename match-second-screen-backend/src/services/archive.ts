import { supabaseAdmin } from '../supabase.js';
import { LiveMatchState, MatchEvent } from './sportsApi.js';
import { TurningPoint } from './turningPoint.js';

const MISSING_COLUMN_HINT =
  'match_archive.turning_point is missing. Run db/migrations/003_match_turning_point.sql ' +
  'to store the computed turning point alongside the summary.';

let warnedMissingColumn = false;

/** "You asked for a column that isn't there", from Postgres or PostgREST. */
function isUnknownColumn(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /column .* does not exist|Could not find the '.*' column/i.test(error.message ?? '')
  );
}

/**
 * Persist a finished match: final state, full event log, generated summary and
 * the computed turning point.
 *
 * Written with the service-role client because the archive's RLS policy grants
 * users SELECT only — the server owns writes. Upsert on match_id (unique) so a
 * repeated final poll cannot duplicate a row.
 */
export async function archiveMatch(
  state: LiveMatchState,
  events: MatchEvent[],
  summary: string,
  turningPoint: TurningPoint | null
): Promise<void> {
  const base = {
    match_id: state.matchId,
    home_team: state.homeTeam,
    away_team: state.awayTeam,
    final_score: `${state.homeScore}-${state.awayScore}`,
    event_log: events,
    summary,
    played_at: state.kickoff ?? new Date().toISOString(),
  };

  const withTurningPoint = { ...base, turning_point: turningPoint };

  let { error } = await supabaseAdmin
    .from('match_archive')
    .upsert(withTurningPoint, { onConflict: 'match_id' });

  if (error && isUnknownColumn(error)) {
    // The migration adding turning_point has not been applied. Archive the
    // match anyway — losing the row entirely would be a far worse outcome than
    // losing one derived field.
    if (!warnedMissingColumn) {
      console.warn(MISSING_COLUMN_HINT);
      warnedMissingColumn = true;
    }
    ({ error } = await supabaseAdmin
      .from('match_archive')
      .upsert(base, { onConflict: 'match_id' }));
  }

  if (error) {
    // Archiving must never take the live feed down with it.
    console.error(`Failed to archive match ${state.matchId}:`, error.message);
    return;
  }

  console.log(
    `Archived match ${state.matchId}` +
      (turningPoint ? ` (turning point ${turningPoint.minute}', ${turningPoint.delta} pts)` : '')
  );
}
