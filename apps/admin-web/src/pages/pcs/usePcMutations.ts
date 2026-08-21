import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toasts";

export function usePcMutations() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const extend = useMutation({
    mutationFn: ({ sessionId, minutes }: { sessionId: string; minutes: number }) =>
      api(`/sessions/${sessionId}/extend`, { method: "POST", body: { minutes } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pcs"] });
      void queryClient.invalidateQueries({ queryKey: ["pc"] });
      toast.push("Session extended");
    },
    onError: (error) => toast.push(error instanceof Error ? error.message : "Extend failed", "error"),
  });

  const endSession = useMutation({
    mutationFn: (sessionId: string) =>
      api(`/sessions/${sessionId}/end`, { method: "POST", body: {} }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pcs"] });
      void queryClient.invalidateQueries({ queryKey: ["pc"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.push("Session ended");
    },
    onError: (error) => toast.push(error instanceof Error ? error.message : "End failed", "error"),
  });

  const command = useMutation({
    mutationFn: ({ pcId, type }: { pcId: string; type: "lock" | "restart" | "shutdown" }) =>
      api(`/pcs/${pcId}/commands`, { method: "POST", body: { type, payload: {}, confirm: true } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pcs"] });
      void queryClient.invalidateQueries({ queryKey: ["pc"] });
      toast.push("Command issued");
    },
    onError: (error) => toast.push(error instanceof Error ? error.message : "Command failed", "error"),
  });

  const busy = extend.isPending || endSession.isPending || command.isPending;

  return { extend, endSession, command, busy };
}
