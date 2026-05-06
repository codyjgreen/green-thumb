import { Redis } from 'ioredis';
import { loadConfig } from './config.js';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (redisClient) return redisClient;

  const config = loadConfig();
  redisClient = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
  });

  redisClient.on('error', () => {
    // Silently ignore connection errors — cache misses are handled gracefully
  });

  return redisClient;
}

export async function isRedisHealthy(): Promise<boolean> {
  try {
    const client = getRedisClient();
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
