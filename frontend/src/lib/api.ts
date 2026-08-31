import { supabase } from './supabase';
import { config } from '../config';

export class ApiError extends Error {
  // Assigned explicitly rather than as a parameter property: the project sets
  // `erasableSyntaxOnly`, which disallows that shorthand.
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('Your session has expired. Please sign in again.', 401);
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when there actually is one: Fastify rejects
        // an empty body sent with `Content-Type: application/json`, which would
        // 400 every bodyless POST/DELETE (save, unsave, unfollow).
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(await authHeader()),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('Could not reach the server. Is the backend running?', 0);
  }

  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'DELETE',
      body: body ? JSON.stringify(body) : undefined,
    }),
};
