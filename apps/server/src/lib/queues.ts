import { Queue } from "bullmq";
import { newRedisConnection } from "./redis.js";

let commandQueue: Queue | null = null;
let sessionsQueue: Queue | null = null;

function connection() {
  return newRedisConnection();
}

export function getCommandQueue(): Queue {
  if (!commandQueue) {
    commandQueue = new Queue("commands", { connection: connection() });
  }
  return commandQueue;
}

export function getSessionsQueue(): Queue {
  if (!sessionsQueue) {
    sessionsQueue = new Queue("sessions", { connection: connection() });
  }
  return sessionsQueue;
}

export async function ensureCommandExpireSchedule(): Promise<void> {
  try {
    await getCommandQueue().add(
      "expire",
      {},
      { repeat: { every: 60_000 }, jobId: "command-expire" },
    );
  } catch (err) {
    console.error("[queues] ensureCommandExpireSchedule failed:", err);
  }
}

export async function ensureSessionSweepSchedule(): Promise<void> {
  try {
    await getSessionsQueue().add(
      "sweep",
      {},
      { repeat: { every: 15_000 }, jobId: "session-sweep" },
    );
  } catch (err) {
    console.error("[queues] ensureSessionSweepSchedule failed:", err);
  }
}

export async function closeQueues(): Promise<void> {
  if (commandQueue) {
    const q = commandQueue;
    commandQueue = null;
    await q.close();
  }
  if (sessionsQueue) {
    const q = sessionsQueue;
    sessionsQueue = null;
    await q.close();
  }
}
