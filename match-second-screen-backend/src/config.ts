import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  databaseUrl: required('DATABASE_URL'),
  supabaseJwtSecret: required('SUPABASE_JWT_SECRET'),
  redisUrl: required('REDIS_URL'),
  apiFootballKey: required('API_FOOTBALL_KEY'),
  apiFootballHost: required('API_FOOTBALL_HOST'),
  useMockSportsData: process.env.USE_MOCK_SPORTS_DATA === 'true',
};