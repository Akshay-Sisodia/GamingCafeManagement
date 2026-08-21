import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { SyncConflictDto } from "../../lib/types";
import { useToast } from "../../components/Toasts";

export function useConflictsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const conflictsQuery = useQuery({
    queryKey: ["conflicts"],
    queryFn: () => api<SyncConflictDto[]>("/sync/conflicts"),
  });

  const resolve = useMutation({
    mutationFn: ({
      id,
      resolution,
    }: {
      id: string;
      resolution: "accept_server" | "accept_offline";
    }) => api(`/sync/conflicts/${id}/resolve`, { method: "POST", body: { resolution } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["conflicts"] });
      toast.push("Conflict resolved");
    },
    onError: (error) =>
      toast.push(error instanceof Error ? error.message : "Resolve failed", "error"),
  });

  return { conflictsQuery, resolve };
}
