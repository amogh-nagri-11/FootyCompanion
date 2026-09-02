import { FastifyInstance } from 'fastify';
import { requireAuth } from '../httpAuth.js';
import {
  DateOutOfRangeError,
  getFixtures,
  getFixturesForDate,
} from '../services/matchList.js';
import { getMatchStats } from '../services/matchStats.js';
import {
  answerMatchQuestion,
  ChatRequestError,
  ChatUnavailableError,
  validateTurns,
} from '../services/matchChat.js';
import { isIsoDate, todayUtc } from '../services/sportsApi.js';

export async function matchRoutes(app: FastifyInstance) {
  app.get('/matches/live', { preHandler: requireAuth }, async (req, reply) => {
    try {
      // `kind` is "upcoming" when nothing is in play and the list has fallen
      // back to the next kickoffs, so the client can label the screen.
      const { matches, cached, kind } = await getFixtures();
      return { matches, cached, kind };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to load live matches',
      });
    }
  });

  /**
   * Fixtures for one UTC day. `date` defaults to today, which is what the home
   * screen asks for on first load.
   */
  app.get('/matches/by-date', { preHandler: requireAuth }, async (req, reply) => {
    const { date } = req.query as { date?: string };
    const day = date?.trim() || todayUtc();

    if (!isIsoDate(day)) {
      return reply.code(400).send({ error: `Invalid date '${day}', expected YYYY-MM-DD` });
    }

    try {
      return await getFixturesForDate(day);
    } catch (err) {
      // A plan-limited date is a normal thing for the user to ask for, not a
      // server fault: answer 400 with the range so the UI can say what it is.
      if (err instanceof DateOutOfRangeError) {
        return reply.code(400).send({ error: err.message, window: err.window });
      }
      app.log.error(err);
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to load fixtures',
      });
    }
  });

  /**
   * The expensive half of a match — team statistics, lineups and player
   * ratings. Kept off the live poll path and served from cache, because each
   * miss is three upstream calls against a 100/day quota.
   *
   * `finished` only picks the cache lifetime; it is a hint from the client, so
   * a wrong value costs freshness, never correctness.
   */
  app.get('/matches/:matchId/stats', { preHandler: requireAuth }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const { finished } = req.query as { finished?: string };

    try {
      return await getMatchStats(matchId, finished === 'true');
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to load match stats',
      });
    }
  });

  app.get('/matches/saved', { preHandler: requireAuth }, async (req, reply) => {
    const { data, error } = await req.db!.from('saved_matches')
      .select('match_id, created_at')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false });
    if (error) return reply.code(400).send({ error: error.message });
    return { saved: data };
  });

  app.post('/matches/:matchId/save', { preHandler: requireAuth }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    // Ignore a repeat save rather than failing on the (user_id, match_id) unique.
    const { error } = await req.db!.from('saved_matches')
      .upsert({ user_id: req.user!.id, match_id: matchId }, { onConflict: 'user_id,match_id' });
    if (error) return reply.code(400).send({ error: error.message });
    return { saved: true, matchId };
  });

  app.delete('/matches/:matchId/save', { preHandler: requireAuth }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const { error } = await req.db!.from('saved_matches')
      .delete()
      .eq('user_id', req.user!.id)
      .eq('match_id', matchId);
    if (error) return reply.code(400).send({ error: error.message });
    return { saved: false, matchId };
  });

  app.get('/matches/archive', { preHandler: requireAuth }, async (req, reply) => {
    const { team, limit } = req.query as { team?: string; limit?: string };
    let query = req.db!.from('match_archive')
      .select('match_id, home_team, away_team, final_score, summary, played_at')
      .order('played_at', { ascending: false })
      .limit(Math.min(Number(limit) || 50, 100));

    if (team) query = query.or(`home_team.ilike.%${team}%,away_team.ilike.%${team}%`);

    const { data, error } = await query;
    if (error) return reply.code(400).send({ error: error.message });
    return { matches: data };
  });

  /**
   * Ask a question about one archived match.
   *
   * Stateless: the client sends the whole thread each time, and nothing is
   * stored. A conversation about a match is worth having once, not worth a
   * table and a retention policy until someone asks to keep them.
   */
  app.post('/matches/archive/:matchId/chat', { preHandler: requireAuth }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const { messages } = (req.body ?? {}) as { messages?: unknown };

    let turns;
    try {
      turns = validateTurns(messages);
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof ChatRequestError ? err.message : 'Invalid request.',
      });
    }

    const { data, error } = await req.db!.from('match_archive')
      .select('match_id, home_team, away_team, final_score, event_log, turning_point, summary, played_at')
      .eq('match_id', matchId)
      .maybeSingle();
    if (error) return reply.code(400).send({ error: error.message });
    if (!data) return reply.code(404).send({ error: 'Not in the archive' });

    try {
      const { answer, cached } = await answerMatchQuestion(
        {
          matchId: data.match_id,
          homeTeam: data.home_team,
          awayTeam: data.away_team,
          finalScore: data.final_score,
          playedAt: data.played_at,
          summary: data.summary,
          events: data.event_log ?? [],
          turningPoint: data.turning_point ?? null,
        },
        turns
      );
      return { answer, cached };
    } catch (err) {
      if (err instanceof ChatUnavailableError) {
        return reply.code(503).send({ error: err.message, unavailable: true });
      }
      app.log.error(err);
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to answer',
      });
    }
  });

  app.get('/matches/archive/:matchId', { preHandler: requireAuth }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const { data, error } = await req.db!.from('match_archive')
      .select('*')
      .eq('match_id', matchId)
      .maybeSingle();
    if (error) return reply.code(400).send({ error: error.message });
    if (!data) return reply.code(404).send({ error: 'Not in the archive' });
    return data;
  });
}
