import Redis from "ioredis";
import { config } from "../config.js";

let publisher: Redis | null = null;

/**
 * Every ioredis connection MUST have an "error" listener — without one,
 * a bad REDIS_URL or transient outage becomes an unhandled exception
 * that kills the whole process.
 */
function attachErrorLogging(conn: Redis, label: string): Redis {
  conn.on("error", (err: Error) => {
    console.error(`[redis:${label}] ${err.message}`);
  });
  return conn;
}

export function newRedisConnection(): Redis {
  const conn = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 1000, 30_000),
    enableOfflineQueue: true,
  });
  return attachErrorLogging(conn, "conn");
}

export function newRedisSubscriber(): Redis {
  const conn = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 1000, 30_000),
  });
  return attachErrorLogging(conn, "sub");
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
