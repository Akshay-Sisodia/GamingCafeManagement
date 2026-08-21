import type { FastifyReply, FastifyRequest } from "fastify";
import { getRedis } from "../../lib/redis.js";

export interface CafeEvent {
  event: string;
  data: unknown;
  pc_id?: string;
}

export interface StreamEntry extends CafeEvent {
  id: number;
}

interface ChannelState {
  entries: StreamEntry[];
  seen: Set<number>;
  counter: number;
}

const RING_SIZE = 200;
const channels = new Map<string, ChannelState>();

function channelState(cafeId: string): ChannelState {
  let state = channels.get(cafeId);
  if (!state) {
    state = { entries: [], seen: new Set(), counter: 0 };
    channels.set(cafeId, state);
  }
  return state;
}

export function allocateEntry(cafeId: string, evt: CafeEvent): StreamEntry {
  const state = channelState(cafeId);
  state.counter += 1;
  const entry: StreamEntry = { id: state.counter, event: evt.event, data: evt.data, pc_id: evt.pc_id };
  if (!state.seen.has(entry.id)) {
    state.seen.add(entry.id);
    state.entries.push(entry);
    if (state.entries.length > RING_SIZE) {
      const dropped = state.entries.shift();
      if (dropped) state.seen.delete(dropped.id);
    }
  }
  return entry;
}

export function publishToCafe(cafeId: string, evt: CafeEvent): StreamEntry {
  const entry = allocateEntry(cafeId, evt);
  void getRedis().publish(`events:${cafeId}`, JSON.stringify(entry));
  return entry;
}

export function rememberRemoteEntry(cafeId: string, raw: string): StreamEntry | null {
  try {
    const parsed = JSON.parse(raw) as StreamEntry;
    if (typeof parsed.id !== "number" || typeof parsed.event !== "string") return null;
    const state = channelState(cafeId);
    if (state.seen.has(parsed.id)) return parsed;
    state.seen.add(parsed.id);
    state.entries.push(parsed);
    if (state.entries.length > RING_SIZE) {
      const dropped = state.entries.shift();
      if (dropped) state.seen.delete(dropped.id);
    }
    while (parsed.id > state.counter) state.counter += 1;
    return parsed;
  } catch {
    return null;
  }
}

export interface SseContext {
  kind: "pc" | "admin";
  pcId?: string;
}

export function matchesContext(entry: CafeEvent & { id?: number }, ctx: SseContext): boolean {
  if (ctx.kind === "admin") return true;
  return entry.pc_id === undefined || entry.pc_id === ctx.pcId;
}

export function getReplay(
  cafeId: string,
  lastEventId: number | null,
  ctx: SseContext,
): StreamEntry[] {
  const state = channels.get(cafeId);
  if (!state) return [];
  return state.entries.filter(
    (e) => (lastEventId === null || e.id > lastEventId) && matchesContext(e, ctx),
  );
}

export function writeSseEvent(res: FastifyReply["raw"], entry: StreamEntry): void {
  res.write(`id: ${entry.id}\nevent: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`);
}
