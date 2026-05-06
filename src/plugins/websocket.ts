import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { addClient, removeClient } from '../lib/broadcast.js';
import { WebSocket } from 'ws';

const WS_PING_INTERVAL_MS = Number(process.env['WS_PING_INTERVAL_MS'] ?? 30000);
const WS_PING_TIMEOUT_MS = Number(process.env['WS_PING_TIMEOUT_MS'] ?? 5000);

// Track connections: userId -> Set of WebSocket connections
const wsConnections = new Map<string, Set<WebSocket>>();

async function websocketPlugin(app: FastifyInstance) {
  await app.register(websocket, {
    options: {
      pingInterval: WS_PING_INTERVAL_MS,
      pingTimeout: WS_PING_TIMEOUT_MS,
    },
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    wsConnections: Map<string, Set<WebSocket>>;
  }
}

/**
 * Register a WebSocket connection for a user.
 * Called from the /ws route after authentication.
 */
export function registerWsConnection(userId: string, ws: WebSocket): void {
  if (!wsConnections.has(userId)) {
    wsConnections.set(userId, new Set());
  }
  wsConnections.get(userId)!.add(ws);
  addClient(userId, ws);
}

/**
 * Remove a WebSocket connection.
 * Called when a connection closes.
 */
export function unregisterWsConnection(userId: string, ws: WebSocket): void {
  const userConnections = wsConnections.get(userId);
  if (userConnections) {
    userConnections.delete(ws);
    if (userConnections.size === 0) {
      wsConnections.delete(userId);
    }
  }
  removeClient(userId, ws);
}

export default fp(websocketPlugin, {
  name: 'websocket',
});
