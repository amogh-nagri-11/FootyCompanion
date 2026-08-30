import { supabaseAdmin } from '../supabase.js';
import { LiveMatchState } from './sportsApi.js';

/** Reads as a sentence in the archive list, so build it from the result. */
function buildSummary(state: LiveMatchState): string {
  const { homeTeam, awayTeam, homeScore, awayScore } = state;
  if (homeScore === awayScore) {
    return `${homeTeam} drew ${homeScore}–${awayScore} with ${awayTeam}.`;
  }
  const [winner, loser, win, lose] =
    homeScore > awayScore
      ? [homeTeam, awayTeam, homeScore, awayScore]
      : [awayTeam, homeTeam, awayScore, homeScore];
  return `${winner} beat ${loser} ${win}–${lose}.`;
}

/**
 * Persist a finished match. Written with the service-role client because the
 * archive's RLS policy grants users SELECT only — the server owns writes.
 * Upsert on match_id (unique) so a repeated final poll cannot duplicate a row.
 */
export async function archiveMatch(state: LiveMatchState): Promise<void> {
  const { error } = await supabaseAdmin.from('match_archive').upsert(
    {
      match_id: state.matchId,
      home_team: state.homeTeam,
      away_team: state.awayTeam,
      final_score: `${state.homeScore}-${state.awayScore}`,
      event_log: state.events,
      summary: buildSummary(state),
      played_at: state.kickoff ?? new Date().toISOString(),
    },
    { onConflict: 'match_id' }
  );

  if (error) {
    // Archiving must never take the live feed down with it.
    console.error(`Failed to archive match ${state.matchId}:`, error.message);
    return;
  }
  console.log(`Archived match ${state.matchId}`);
}
