import { FastifyInstance } from 'fastify';
import { requireAuth } from '../httpAuth.js';
import { supabaseAdmin } from '../supabase.js';
import {
  getProfile,
  updateProfile,
  migrationPending,
  ProfileFields,
} from '../services/profile.js';

const LIMITS = {
  username: { min: 3, max: 30 },
  displayName: 50,
  bio: 300,
  favouriteTeam: 60,
  avatarUrl: 500,
};

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/** Returns an error message, or null when the whole patch is acceptable. */
function validate(body: Record<string, unknown>): string | null {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : null);

  if ('username' in body) {
    const username = str(body.username);
    if (!username) return 'Username cannot be empty.';
    if (username.length < LIMITS.username.min || username.length > LIMITS.username.max) {
      return `Username must be between ${LIMITS.username.min} and ${LIMITS.username.max} characters.`;
    }
    if (!USERNAME_PATTERN.test(username)) {
      return 'Username can only contain letters, numbers, and . _ -';
    }
  }

  if ('displayName' in body) {
    const displayName = str(body.displayName);
    if (displayName && displayName.length > LIMITS.displayName) {
      return `Display name must be ${LIMITS.displayName} characters or fewer.`;
    }
  }

  if ('bio' in body) {
    const bio = str(body.bio);
    if (bio && bio.length > LIMITS.bio) {
      return `Bio must be ${LIMITS.bio} characters or fewer.`;
    }
  }

  if ('favouriteTeam' in body) {
    const team = str(body.favouriteTeam);
    if (team && team.length > LIMITS.favouriteTeam) {
      return `Favourite team must be ${LIMITS.favouriteTeam} characters or fewer.`;
    }
  }

  if ('avatarUrl' in body) {
    const url = str(body.avatarUrl);
    if (url) {
      if (url.length > LIMITS.avatarUrl) return 'Avatar URL is too long.';
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return 'Avatar URL must be a valid URL.';
      }
      // http(s) only: a data: or javascript: URL rendered as an image src is an
      // injection vector, and the browser cannot load anything else usefully.
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return 'Avatar URL must start with http:// or https://';
      }
    }
  }

  return null;
}

const FIELD_TO_API: Record<string, string> = {
  display_name: 'displayName',
  avatar_url: 'avatarUrl',
  favourite_team: 'favouriteTeam',
  bio: 'bio',
  username: 'username',
};

/** Maps the API's camelCase body onto the database's snake_case columns. */
function toFields(body: Record<string, unknown>): ProfileFields {
  const fields: ProfileFields = {};
  const clean = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : null;
    return s ? s : null;
  };

  if ('username' in body) fields.username = clean(body.username);
  if ('displayName' in body) fields.display_name = clean(body.displayName);
  if ('bio' in body) fields.bio = clean(body.bio);
  if ('avatarUrl' in body) fields.avatar_url = clean(body.avatarUrl);
  if ('favouriteTeam' in body) fields.favourite_team = clean(body.favouriteTeam);
  return fields;
}

export async function profileRoutes(app: FastifyInstance) {
  app.get('/profile', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const profile = await getProfile(req.db!, req.user!.id);
      if (!profile) return reply.code(404).send({ error: 'Profile not found' });

      const [follows, saves] = await Promise.all([
        req.db!.from('followed_teams').select('*', { count: 'exact', head: true })
          .eq('user_id', req.user!.id),
        req.db!.from('saved_matches').select('*', { count: 'exact', head: true })
          .eq('user_id', req.user!.id),
      ]);

      return {
        ...profile,
        // The email lives in auth.users, not profiles, and reaches us on the JWT.
        email: req.user!.email ?? null,
        stats: {
          followedTeams: follows.count ?? 0,
          savedMatches: saves.count ?? 0,
        },
        migrationPending: migrationPending(),
      };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.patch('/profile', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const invalid = validate(body);
    if (invalid) return reply.code(400).send({ error: invalid });

    const fields = toFields(body);
    if (Object.keys(fields).length === 0) {
      return reply.code(400).send({ error: 'No profile fields supplied.' });
    }

    try {
      const { profile, skipped } = await updateProfile(req.db!, req.user!.id, fields);
      // Report back in the same casing the client sent.
      return { ...profile, skipped: skipped.map((f) => FIELD_TO_API[f] ?? f) };
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'DUPLICATE_USERNAME') {
        return reply.code(409).send({ error: 'That username is already taken.' });
      }
      return reply.code(400).send({ error: message });
    }
  });

  /*
   * Deleting the auth user cascades to profiles, and profiles cascades to
   * followed_teams and saved_matches, so this one call removes everything the
   * user owns. It needs the service-role key, which is why it is a server route
   * rather than a client-side supabase-js call.
   */
  app.delete('/profile', { preHandler: requireAuth }, async (req, reply) => {
    const { confirm } = (req.body ?? {}) as { confirm?: string };
    const email = req.user!.email;

    // Require the account's own email back, so a stray DELETE cannot wipe an
    // account. The client asks the user to type it.
    if (!email || confirm?.trim().toLowerCase() !== email.toLowerCase()) {
      return reply.code(400).send({
        error: 'Type your email address exactly to confirm account deletion.',
      });
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(req.user!.id);
    if (error) return reply.code(400).send({ error: error.message });

    req.log.info(`Deleted account ${req.user!.id}`);
    return { deleted: true };
  });
}
