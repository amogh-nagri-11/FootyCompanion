/**
 * Fills `followed_teams.team_id` for rows created before ids existed.
 *
 * Run once after applying db/migrations/004: `npm run backfill:team-ids`
 *
 * Rows it cannot resolve are left alone rather than guessed at — an unresolved
 * follow still matches by name, and a wrong id would silently follow the wrong
 * club. Safe to re-run: it only touches rows where team_id is null, so a later
 * run picks up names that became resolvable once their team next played.
 */

import { supabaseAdmin } from '../supabase.js';
import { resolveTeamId } from '../services/teamDirectory.js';

async function main() {
  const { data, error } = await supabaseAdmin
    .from('followed_teams')
    .select('user_id, team_name, team_id')
    .is('team_id', null);

  if (error) {
    console.error('Could not read followed_teams:', error.message);
    process.exit(1);
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    console.log('Nothing to backfill — every follow already has a team id.');
    process.exit(0);
  }

  console.log(`Resolving ${rows.length} follow(s)…\n`);

  let resolved = 0;
  const unresolved: string[] = [];

  for (const row of rows) {
    const match = await resolveTeamId(row.team_name);
    if (!match) {
      unresolved.push(row.team_name);
      console.log(`  —  ${row.team_name}: no confident match, left by name`);
      continue;
    }

    const { error: updateError } = await supabaseAdmin
      .from('followed_teams')
      .update({ team_id: match.id, team_name: match.name })
      .eq('user_id', row.user_id)
      .eq('team_name', row.team_name);

    if (updateError) {
      console.log(`  !  ${row.team_name}: ${updateError.message}`);
      continue;
    }

    resolved++;
    console.log(`  ok ${row.team_name} -> ${match.name} (#${match.id})`);
  }

  console.log(`\nResolved ${resolved}/${rows.length}.`);
  if (unresolved.length > 0) {
    console.log(
      `Still by name: ${unresolved.join(', ')}\n` +
        'These resolve once those teams appear in a fetched fixture list — re-run then.'
    );
  }
  process.exit(0);
}

void main();
