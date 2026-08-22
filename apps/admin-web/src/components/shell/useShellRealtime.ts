import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API, auth, fetchSseToken } from "../../lib/api";
import { useSSE } from "../../hooks/useSSE";

export function useShellRealtime() {
  const queryClient = useQueryClient();
  const user = auth.user();
  const [sseToken, setSseToken] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !auth.token()) {
      setSseToken(null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const token = await fetchSseToken();
      if (!cancelled) setSseToken(token);
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 4 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.id, user?.cafe_id]);

  const sseUrl = useMemo(
    () =>
      user && sseToken
        ? `${API}/v1/realtime/admin?cafe=${encodeURIComponent(user.cafe_id)}&token=${encodeURIComponent(sseToken)}`
        : null,
    [user, sseToken],
  );
  const { connected, subscribe } = useSSE(sseUrl);

  useEffect(() => {
    return subscribe((event) => {
      switch (event) {
        case "pc.status":
        case "session.updated":
          void queryClient.invalidateQueries({ queryKey: ["pcs"] });
          void queryClient.invalidateQueries({ queryKey: ["pc"] });
          void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          break;
        case "order.updated":
          void queryClient.invalidateQueries({ queryKey: ["orders"] });
          void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          break;
        case "deployment.progress":
          void queryClient.invalidateQueries({ queryKey: ["deployments"] });
          break;
        case "sync.conflict":
          void queryClient.invalidateQueries({ queryKey: ["conflicts"] });
          break;
        default:
          break;
      }
    });
  }, [subscribe, queryClient]);

  return { user, connected };
}
