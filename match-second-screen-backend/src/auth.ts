import { jwtVerify, createRemoteJWKSet } from 'jose';
import { config } from './config.js';

export interface AuthedUser {
  id: string;
  email?: string;
}

const JWKS = createRemoteJWKSet(
  new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`)
);

export async function verifyToken(token: string): Promise<AuthedUser> {
  const { payload } = await jwtVerify(token, JWKS);
  if (!payload.sub) throw new Error('Token missing sub claim');
  return { id: payload.sub, email: payload.email as string | undefined };
}