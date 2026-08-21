import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API, auth } from "../../lib/api";
import { useSSE } from "../../hooks/useSSE";

export function useShellRealtime() {
  const queryClient = useQueryClient();
  const user = auth.user();
  const token = auth.token();

  const sseUrl = useMemo(
    () =>
      user && token
        ? `${API}/v1/realtime/admin?cafe=${encodeURIComponent(user.cafe_id)}&token=${encodeURIComponent(token)}`
        : null,
    [user, token],
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
