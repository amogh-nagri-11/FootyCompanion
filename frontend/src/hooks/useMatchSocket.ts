import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { config } from '../config';
import type {
  FplAlert,
  MatchEvent,
  MatchState,
  ServerMessage,
  SquadView,
  WinProb,
  FeedHealth,
} from '../types';

/**
 * connecting  — opening the socket / fetching the access token
 * waiting     — authenticated, but the server has not pushed a state yet.
 *               The backend only broadcasts on *new* events, so this is a
 *               normal state to sit in for a while, not a failure.
 * live        — we have match state
 * ended       — status came back "finished" (or the socket closed after that)
 * error       — auth rejected, or we gave up reconnecting
 */
export type ConnectionStatus = 'connecting' | 'waiting' | 'live' | 'ended' | 'error';

/** How long a freshly-arrived event keeps its highlight. */
const HIGHLIGHT_MS = 4000;
/** How long an FPL alert stays on screen before fading out of the list. */
const ALERT_MS = 30000;
const MAX_ALERTS = 4;
const MAX_RECONNECT_ATTEMPTS = 5;

interface MatchData {
  status: ConnectionStatus;
  error: string | null;
  state: MatchState | null;
  winProb: WinProb | null;
  events: MatchEvent[];
  freshEventIds: Set<string>;
  /** Null until the user links an FPL team, or if this is not a PL fixture. */
  squad: SquadView | null;
  fplLinked: boolean;
  /** Null while the feed is healthy; set when the server says it is not. */
  feedHealth: FeedHealth | null;
  fplAlerts: FplAlert[];
}

const INITIAL: MatchData = {
  status: 'connecting',
  error: null,
  state: null,
  winProb: null,
  events: [],
  freshEventIds: new Set(),
  squad: null,
  fplLinked: false,
  feedHealth: null,
  fplAlerts: [],
};

export function useMatchSocket(matchId: string): MatchData {
  const [data, setData] = useState<MatchData>(INITIAL);
  const [trackedMatchId, setTrackedMatchId] = useState(matchId);

  // Reset during render rather than in the effect, so a match switch never
  // paints one match's events under another match's scoreboard.
  if (trackedMatchId !== matchId) {
    setTrackedMatchId(matchId);
    setData(INITIAL);
  }

  const socketRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Once the match is over we must not reconnect — the backend has stopped
  // polling it, so a new socket would just sit there forever.
  const endedRef = useRef(false);

  useEffect(() => {
    endedRef.current = false;
    attemptsRef.current = 0;

    let disposed = false;

    function clearHighlight(ids: string[]) {
      const timer = setTimeout(() => {
        setData((prev) => {
          const next = new Set(prev.freshEventIds);
          for (const id of ids) next.delete(id);
          return { ...prev, freshEventIds: next };
        });
      }, HIGHLIGHT_MS);
      highlightTimersRef.current.push(timer);
    }

    function handleMessage(raw: string) {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw) as ServerMessage;
      } catch {
        console.warn('Ignoring unparseable websocket message', raw);
        return;
      }

      if (msg.type === 'connected') {
        attemptsRef.current = 0;
        setData((prev) => ({
          ...prev,
          // A reconnect that already has state should go straight back to live.
          status: prev.state ? 'live' : 'waiting',
          error: null,
          fplLinked: msg.fplLinked ?? prev.fplLinked,
        }));
        return;
      }

      if (msg.type === 'feed_health') {
        // A recovery arrives as status 'ok', which clears the banner rather
        // than leaving a stale warning above a feed that is working again.
        setData((prev) => ({
          ...prev,
          feedHealth: msg.health.status === 'ok' ? null : msg.health,
        }));
        return;
      }

      if (msg.type === 'fpl_update') {
        const { type: _t, matchId: _m, ...squad } = msg;
        setData((prev) => ({ ...prev, squad, fplLinked: true }));
        return;
      }

      if (msg.type === 'fpl_alert') {
        // The same player can feature twice in one match, so key on the event
        // rather than the player.
        const key = `${msg.player.fplId}-${msg.event.minute}-${msg.role}`;
        setData((prev) =>
          prev.fplAlerts.some((a) => a.key === key)
            ? prev
            : { ...prev, fplAlerts: [{ ...msg, key }, ...prev.fplAlerts].slice(0, MAX_ALERTS) }
        );

        const timer = setTimeout(() => {
          setData((prev) => ({
            ...prev,
            fplAlerts: prev.fplAlerts.filter((a) => a.key !== key),
          }));
        }, ALERT_MS);
        highlightTimersRef.current.push(timer);
        return;
      }

      if (msg.type !== 'update') return;

      const incoming = msg.events ?? [];

      setData((prev) => {
        const seen = new Set(prev.events.map((e) => e.id));
        const added = incoming.filter((e) => !seen.has(e.id));

        // Newest first. The poller can deliver several events in one batch,
        // so sort rather than relying on arrival order.
        const events = [...added, ...prev.events].sort((a, b) => b.minute - a.minute);

        const fresh = new Set(prev.freshEventIds);
        for (const e of added) fresh.add(e.id);

        const finished = msg.state?.status === 'finished';
        if (finished) endedRef.current = true;

        return {
          ...prev,
          status: finished ? 'ended' : 'live',
          error: null,
          state: msg.state ?? prev.state,
          winProb: msg.winProb ?? prev.winProb,
          events,
          freshEventIds: fresh,
        };
      });

      const addedIds = incoming.map((e) => e.id);
      if (addedIds.length > 0) clearHighlight(addedIds);
    }

    async function connect() {
      if (disposed || endedRef.current) return;

      const { data: sessionData, error } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (error || !token) {
        setData((prev) => ({
          ...prev,
          status: 'error',
          error: 'Your session has expired. Please sign in again.',
        }));
        return;
      }

      if (disposed) return;

      const url = `${config.wsUrl}/ws/match/${encodeURIComponent(matchId)}?token=${encodeURIComponent(token)}`;
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onmessage = (ev) => handleMessage(String(ev.data));

      socket.onerror = () => {
        // `onclose` always follows; the retry decision is made there so we
        // don't surface a transient blip as a hard error.
      };

      socket.onclose = (ev) => {
        // `disposed` is captured per effect run, so a socket torn down by the
        // cleanup (React StrictMode remounts, matchId change) never reconnects.
        if (disposed) return;

        // Server-side auth rejections — retrying will not help.
        if (ev.code === 4001 || ev.code === 4002) {
          setData((prev) => ({
            ...prev,
            status: 'error',
            error: 'The server rejected your session. Please sign out and back in.',
          }));
          return;
        }

        // The match finished: the socket going quiet here is expected, not a fault.
        if (endedRef.current) {
          setData((prev) => ({ ...prev, status: 'ended', error: null }));
          return;
        }

        if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          setData((prev) => ({
            ...prev,
            status: 'error',
            error: 'Lost connection to the match feed. Reload to try again.',
          }));
          return;
        }

        const delay = Math.min(1000 * 2 ** attemptsRef.current, 15000);
        attemptsRef.current += 1;
        setData((prev) => ({ ...prev, status: 'connecting' }));
        reconnectTimerRef.current = setTimeout(connect, delay);
      };
    }

    void connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      for (const t of highlightTimersRef.current) clearTimeout(t);
      highlightTimersRef.current = [];
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [matchId]);

  return data;
}
