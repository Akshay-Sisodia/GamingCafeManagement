import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API, auth } from "../../lib/api";
import { useSSE } from "../../hooks/useSSE";

export function useKitchenSSE() {
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
      if (event === "order.updated") {
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
      }
    });
  }, [subscribe, queryClient]);

  return connected;
}
