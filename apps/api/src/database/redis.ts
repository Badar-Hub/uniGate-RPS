import { Redis } from 'ioredis';
import { logger } from '@/logging/logger.js';

let client: Redis | null = null;

export function redis(url: string): Redis {
  if (client) return client;
  client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  client.on('error', (err) => { logger().error({ err }, 'redis error'); });
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}
