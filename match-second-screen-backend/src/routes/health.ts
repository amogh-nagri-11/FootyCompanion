import { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { supabaseAdmin } from '../supabase.js';
import { fetchLiveMatch } from '../services/sportsApi.js';
import { startPolling } from '../services/matchPoller.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/health/db', async () => {
    const result = await pool.query('select now()');
    return { postgres_time: result.rows[0].now };
  });

  app.get('/health/supabase', async () => {
    const { data, error } = await supabaseAdmin.from('match_archive').select('*').limit(1);
    if (error) throw error;
    return { supabase_ok: true, rows: data };
  });

  app.get('/health/sports-api', async () => {
    const match = await fetchLiveMatch('test123');
    return match;
  });
}