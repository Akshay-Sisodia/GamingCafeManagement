import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { Worker } from "bullmq";
import pino from "pino";
import { config } from "./config.js";
import { closeDb, db } from "./db/index.js";
import { closeQueues, ensureSessionSweepSchedule } from "./lib/queues.js";
import { closeRedis, newRedisConnection } from "./lib/redis.js";
import {
  expireDueSessions,
  markStalePcsOffline,
} from "./modules/sessions/expiry.js";

const log = pino({ level: config.LOG_LEVEL });

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybe = result as { rows?: T[] };
  return maybe.rows ?? [];
}

export interface WorkerHandle {
  commandWorker: Worker;
  sessionWorker: Worker;
  close(): Promise<void>;
}

export async function startWorker(): Promise<WorkerHandle> {
  const connection = newRedisConnection();

  const commandWorker = new Worker(
    "commands",
    async () => {
      const result = await db.execute(sql`
        UPDATE pc_commands
        SET status = 'expired'
        WHERE status IN ('pending', 'sent') AND expires_at <= now()
        RETURNING id
      `);
      const expired = rowsOf<{ id: string }>(result);
      if (expired.length > 0) {
        log.info({ count: expired.length }, "expired stale pc_commands");
      }
    },
    { connection },
  );

  const sessionWorker = new Worker(
    "sessions",
    async () => {
      const expiredSessions = await expireDueSessions();
      const offlinePcs = await markStalePcsOffline();
      if (expiredSessions.length > 0 || offlinePcs.length > 0) {
        log.info(
          {
            expired_sessions: expiredSessions.length,
            pcs_offline: offlinePcs.length,
          },
          "session sweep complete",
        );
      }
    },
    { connection },
  );

  commandWorker.on("failed", (job, err) => {
    log.error({ jobId: job?.id ?? null, err }, "commands worker job failed");
  });
  sessionWorker.on("failed", (job, err) => {
    log.error({ jobId: job?.id ?? null, err }, "sessions worker job failed");
  });

  await ensureSessionSweepSchedule();

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await commandWorker.close();
    await sessionWorker.close();
    connection.disconnect();
    await closeQueues();
    await closeRedis();
    await closeDb();
  };

  const shutdown = (signal: string): void => {
    void close()
      .then(() => {
        log.info({ signal }, "worker shut down cleanly");
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err }, "worker shutdown failed");
        process.exit(1);
      });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  log.info("worker started (queues: commands, sessions)");
  return { commandWorker, sessionWorker, close };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void startWorker().catch((err) => {
    log.error({ err }, "worker failed to start");
    process.exit(1);
  });
}
