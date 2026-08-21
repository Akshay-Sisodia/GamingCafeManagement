import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toasts";

export function usePcSessionMutations(pcId: string, onEndSettled?: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const extend = useMutation({
    mutationFn: ({ sessionId, minutes }: { sessionId: string; minutes: number }) =>
      api(`/sessions/${sessionId}/extend`, { method: "POST", body: { minutes } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pc", pcId] });
      void queryClient.invalidateQueries({ queryKey: ["pcs"] });
      toast.push("Session extended");
    },
    onError: (error) => toast.push(error instanceof Error ? error.message : "Extend failed", "error"),
  });

  const endSession = useMutation({
    mutationFn: (sessionId: string) =>
      api(`/sessions/${sessionId}/end`, { method: "POST", body: {} }),
    onSuccess: () => {
      onEndSettled?.();
      void queryClient.invalidateQueries({ queryKey: ["pc", pcId] });
      void queryClient.invalidateQueries({ queryKey: ["pcs"] });
      toast.push("Session ended");
    },
    onError: (error) => {
      onEndSettled?.();
      toast.push(error instanceof Error ? error.message : "End failed", "error");
    },
  });

  return { extend, endSession, busy: extend.isPending || endSession.isPending };
}
