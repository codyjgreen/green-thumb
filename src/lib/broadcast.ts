import { WebSocket } from 'ws';

// Map of userId -> Set of their WebSocket connections
const clients = new Map<string, Set<WebSocket>>();

// Map of userId -> Set of subscribed event types
const subscriptions = new Map<string, Set<string>>();

export interface BroadcastMessage {
  type: 'event';
  event: string;
  payload: object;
  timestamp: number;
}

/**
 * Register a new WebSocket connection for a user.
 */
export function addClient(userId: string, ws: WebSocket): void {
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId)!.add(ws);
}

/**
 * Remove a WebSocket connection when it disconnects.
 */
export function removeClient(userId: string, ws: WebSocket): void {
  const userClients = clients.get(userId);
  if (userClients) {
    userClients.delete(ws);
    if (userClients.size === 0) {
      clients.delete(userId);
      subscriptions.delete(userId);
    }
  }
}

/**
 * Subscribe a user to specific event types.
 */
export function subscribe(userId: string, events: string[]): void {
  if (!subscriptions.has(userId)) {
    subscriptions.set(userId, new Set());
  }
  const userSubs = subscriptions.get(userId)!;
  for (const event of events) {
    userSubs.add(event);
  }
}

/**
 * Unsubscribe a user from specific event types.
 */
export function unsubscribe(userId: string, events: string[]): void {
  const userSubs = subscriptions.get(userId);
  if (!userSubs) return;
  for (const event of events) {
    userSubs.delete(event);
  }
}

/**
 * Broadcast an event to all clients subscribed to that event type.
 */
export function broadcast(event: string, payload: object): void {
  const timestamp = Date.now();
  const message: BroadcastMessage = { type: 'event', event, payload, timestamp };
  const messageStr = JSON.stringify(message);

  for (const [userId, userClients] of clients.entries()) {
    const userSubs = subscriptions.get(userId);
    // If user has no subscriptions, don't send anything (explicit opt-in)
    if (!userSubs || userSubs.size === 0) continue;
    if (!userSubs.has(event)) continue;

    for (const ws of userClients) {
      try {
        ws.send(messageStr);
      } catch {
        // Client disconnected, remove from set
        removeClient(userId, ws);
      }
    }
  }
}
