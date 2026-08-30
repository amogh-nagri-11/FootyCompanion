import { WebSocket } from 'ws';

const matchSubscribers = new Map<string, Set<WebSocket>>();

export function subscribe(matchId: string, socket: WebSocket) {
  if (!matchSubscribers.has(matchId)) {
    matchSubscribers.set(matchId, new Set());
  }
  matchSubscribers.get(matchId)!.add(socket);
}

export function unsubscribe(matchId: string, socket: WebSocket) {
  matchSubscribers.get(matchId)?.delete(socket);
  if (matchSubscribers.get(matchId)?.size === 0) {
    matchSubscribers.delete(matchId);
  }
}

export function broadcast(matchId: string, payload: unknown) {
  const subscribers = matchSubscribers.get(matchId);
  if (!subscribers) return;

  const message = JSON.stringify(payload);
  for (const socket of subscribers) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
}

export function hasSubscribers(matchId: string): boolean {
  return (matchSubscribers.get(matchId)?.size ?? 0) > 0;
}