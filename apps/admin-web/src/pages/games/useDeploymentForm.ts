import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { DeploymentDto } from "../../lib/types";
import { useToast } from "../../components/Toasts";

export function useCreateDeployment(
  gameId: string,
  versionId: string,
  masterPcId: string,
  targets: Set<string>,
  onReset: () => void,
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: (body: {
      game_id: string;
      target_version_id: string;
      master_pc_id: string;
      pc_ids: string[];
    }) => api<DeploymentDto>("/deployments", { method: "POST", body }),
    onSuccess: () => {
      onReset();
      void queryClient.invalidateQueries({ queryKey: ["deployments"] });
      toast.push("Deployment created");
    },
    onError: (error) =>
      toast.push(error instanceof Error ? error.message : "Deploy failed", "error"),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!gameId || !masterPcId || targets.size === 0 || !versionId.trim()) {
      toast.push("Select a game, version, master PC and at least one target.", "error");
      return;
    }
    mutation.mutate({
      game_id: gameId,
      target_version_id: versionId.trim(),
      master_pc_id: masterPcId,
      pc_ids: [...targets],
    });
  }

  return { handleSubmit, isPending: mutation.isPending };
}

export function useDeploymentTargets() {
  const [targets, setTargets] = useState<Set<string>>(new Set());

  function toggleTarget(pcId: string) {
    setTargets((current) => {
      const next = new Set(current);
      if (next.has(pcId)) next.delete(pcId);
      else next.add(pcId);
      return next;
    });
  }

  function resetTargets() {
    setTargets(new Set());
  }

  return { targets, toggleTarget, resetTargets };
}
