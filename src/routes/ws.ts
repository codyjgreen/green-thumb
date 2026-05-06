import type { FastifyInstance, FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';
import { registerWsConnection, unregisterWsConnection } from '../plugins/websocket.js';
import { subscribe, unsubscribe } from '../lib/broadcast.js';

interface SubscribeMessage {
  type: 'subscribe';
  events: string[];
}

interface UnsubscribeMessage {
  type: 'unsubscribe';
  events: string[];
}

interface PingMessage {
  type: 'ping';
}

type ClientMessage = SubscribeMessage | UnsubscribeMessage | PingMessage;

// Use a WeakMap to store userId per socket (avoids module augmentation issues)
const socketUserId = new WeakMap<WebSocket, string>();
const socketAlive = new WeakMap<WebSocket, boolean>();

export async function registerWsRoutes(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    // Extract token from query param or Authorization header
    const token =
      (request.query as Record<string, string>)['token'] ||
      request.headers['authorization']?.replace(/^Bearer\s+/i, '');

    if (!token) {
      socket.send(JSON.stringify({ type: 'auth_error', message: 'Missing authentication token' }));
      socket.close(4001, 'Unauthorized');
      return;
    }

    // Verify JWT
    let userId: string;
    try {
      const payload = app.jwt.verify(token) as { userId: string; email: string };
      userId = payload.userId;
    } catch {
      socket.send(JSON.stringify({ type: 'auth_error', message: 'Invalid or expired token' }));
      socket.close(4001, 'Unauthorized');
      return;
    }

    socketUserId.set(socket, userId);
    socketAlive.set(socket, true);

    // Register the connection
    registerWsConnection(userId, socket);

    // Send connected confirmation
    socket.send(
      JSON.stringify({
        type: 'connected',
        userId,
        timestamp: Date.now(),
      }),
    );

    // Handle incoming messages
    socket.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return; // Ignore malformed messages
      }

      switch (msg.type) {
        case 'subscribe':
          if (Array.isArray(msg.events)) {
            subscribe(userId, msg.events);
          }
          break;
        case 'unsubscribe':
          if (Array.isArray(msg.events)) {
            unsubscribe(userId, msg.events);
          }
          break;
        case 'ping':
          socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
      }
    });

    // Handle pong responses for heartbeat
    socket.on('pong', () => {
      socketAlive.set(socket, true);
    });

    // Handle close
    socket.on('close', () => {
      const storedUserId = socketUserId.get(socket);
      if (storedUserId) {
        unregisterWsConnection(storedUserId, socket);
        socketUserId.delete(socket);
        socketAlive.delete(socket);
      }
    });

    // Handle errors
    socket.on('error', (err) => {
      const storedUserId = socketUserId.get(socket);
      console.error(`[WS] Socket error for user ${storedUserId}:`, err);
      if (storedUserId) {
        unregisterWsConnection(storedUserId, socket);
        socketUserId.delete(socket);
        socketAlive.delete(socket);
      }
    });
  });
}
