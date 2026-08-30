import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * Saved matches and followed teams, loaded once and kept in memory. Both are
 * small sets consulted by several screens, and both need optimistic toggling
 * so a star or follow button responds immediately.
 */
export function useUserLists() {
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [savedRes, followRes] = await Promise.all([
        api.get<{ saved: { match_id: string }[] }>('/matches/saved'),
        api.get<{ teams: { team_name: string }[] }>('/follows'),
      ]);
      setSaved(new Set(savedRes.saved.map((s) => s.match_id)));
      setTeams(new Set(followRes.teams.map((t) => t.team_name)));
    } catch {
      // A failure here should not block the match list; buttons simply show
      // the un-toggled state until the next load succeeds.
    }
  }, []);

  useEffect(() => {
    // `load` is async, so its setState calls run after an await rather than
    // synchronously during the effect; fetching on mount is what effects are for.
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  async function toggleSave(matchId: string) {
    const wasSaved = saved.has(matchId);
    setSaved((prev) => {
      const next = new Set(prev);
      if (wasSaved) next.delete(matchId);
      else next.add(matchId);
      return next;
    });
    try {
      if (wasSaved) await api.del(`/matches/${encodeURIComponent(matchId)}/save`);
      else await api.post(`/matches/${encodeURIComponent(matchId)}/save`);
    } catch {
      void load(); // Roll back to whatever the server actually holds.
    }
  }

  async function toggleFollow(teamName: string) {
    const wasFollowing = teams.has(teamName);
    setTeams((prev) => {
      const next = new Set(prev);
      if (wasFollowing) next.delete(teamName);
      else next.add(teamName);
      return next;
    });
    try {
      if (wasFollowing) await api.del(`/follows/${encodeURIComponent(teamName)}`);
      else await api.post('/follows', { teamName });
    } catch {
      void load();
    }
  }

  return { saved, teams, toggleSave, toggleFollow, reload: load };
}
