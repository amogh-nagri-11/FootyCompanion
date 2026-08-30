import { WebSocket } from 'ws';

/**
 * A single websocket plus who is on the other end. FPL payloads are specific to
 * one user's squad, so the registry has to carry identity — a plain set of
 * sockets can only ever send everyone the same thing.
 */
export interface Subscriber {
  socket: WebSocket;
  userId: string;
  fplTeamId: number | null;
}

const matchSubscribers = new Map<string, Set<Subscriber>>();

export function subscribe(
  matchId: string,
  socket: WebSocket,
  userId: string,
  fplTeamId: number | null
): Subscriber {
  const subscriber: Subscriber = { socket, userId, fplTeamId };
  const existing = matchSubscribers.get(matchId);
  if (existing) existing.add(subscriber);
  else matchSubscribers.set(matchId, new Set([subscriber]));
  return subscriber;
}

export function unsubscribe(matchId: string, subscriber: Subscriber) {
  const subscribers = matchSubscribers.get(matchId);
  if (!subscribers) return;
  subscribers.delete(subscriber);
  if (subscribers.size === 0) matchSubscribers.delete(matchId);
}

export function send(subscriber: Subscriber, payload: unknown) {
  if (subscriber.socket.readyState === subscriber.socket.OPEN) {
    subscriber.socket.send(JSON.stringify(payload));
  }
}

export function broadcast(matchId: string, payload: unknown) {
  const subscribers = matchSubscribers.get(matchId);
  if (!subscribers) return;

  const message = JSON.stringify(payload);
  for (const subscriber of subscribers) {
    if (subscriber.socket.readyState === subscriber.socket.OPEN) {
      subscriber.socket.send(message);
    }
  }
}

export function getSubscribers(matchId: string): Subscriber[] {
  return [...(matchSubscribers.get(matchId) ?? [])];
}

export function hasSubscribers(matchId: string): boolean {
  return (matchSubscribers.get(matchId)?.size ?? 0) > 0;
}
