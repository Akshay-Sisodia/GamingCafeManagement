import { useCallback, useEffect, useRef, useState } from "react";

export type SseHandler = (event: string, data: unknown) => void;

const KNOWN_EVENTS = [
  "pc.status",
  "session.updated",
  "order.updated",
  "deployment.progress",
  "sync.conflict",
  "notification",
] as const;

export function useSSE(
  url: string | null,
): { connected: boolean; subscribe: (handler: SseHandler) => () => void } {
  const [connected, setConnected] = useState(false);
  const handlers = useRef(new Set<SseHandler>());

  const subscribe = useCallback((handler: SseHandler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    if (!url) {
      setConnected(false);
      return;
    }
    const source = new EventSource(url);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    const listeners: Array<[string, (event: MessageEvent) => void]> = [];
    for (const name of KNOWN_EVENTS) {
      const listener = (event: MessageEvent): void => {
        let data: unknown = null;
        try {
          data = event.data ? (JSON.parse(event.data as string) as unknown) : null;
        } catch {
          data = event.data;
        }
        for (const handler of handlers.current) handler(name, data);
      };
      source.addEventListener(name, listener as EventListener);
      listeners.push([name, listener]);
    }

    return () => {
      for (const [name, listener] of listeners) {
        source.removeEventListener(name, listener as EventListener);
      }
      source.close();
    };
  }, [url]);

  return { connected, subscribe };
}
