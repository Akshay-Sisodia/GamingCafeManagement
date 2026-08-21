import Redis from "ioredis";
import { config } from "../config.js";

let publisher: Redis | null = null;

export function newRedisConnection(): Redis {
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
}

export function getRedis(): Redis {
  if (!publisher) {
    publisher = newRedisConnection();
  }
  return publisher;
}

export async function closeRedis(): Promise<void> {
  if (publisher) {
    const client = publisher;
    publisher = null;
    client.disconnect();
  }
}
