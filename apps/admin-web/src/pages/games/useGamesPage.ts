import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { DeploymentDto, GameDto, PcDto } from "../../lib/types";
import { useCreateDeployment, useDeploymentTargets } from "./useDeploymentForm";

export function useGamesPage() {
  const [gameId, setGameId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [masterPcId, setMasterPcId] = useState("");
  const { targets, toggleTarget, resetTargets } = useDeploymentTargets();

  const gamesQuery = useQuery({ queryKey: ["games"], queryFn: () => api<GameDto[]>("/games") });
  const pcsQuery = useQuery({ queryKey: ["pcs"], queryFn: () => api<PcDto[]>("/pcs") });
  const deploymentsQuery = useQuery({
    queryKey: ["deployments"],
    queryFn: () => api<DeploymentDto[]>("/deployments"),
  });

  const { handleSubmit, isPending: createPending } = useCreateDeployment(
    gameId,
    versionId,
    masterPcId,
    targets,
    () => {
      setVersionId("");
      resetTargets();
    },
  );

  const games = gamesQuery.data ?? [];
  const pcs = pcsQuery.data ?? [];
  const onlinePcs = pcs.filter((pc) => pc.status === "online");
  const deployments = [...(deploymentsQuery.data ?? [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );

  return {
    gamesQuery,
    pcsQuery,
    deploymentsQuery,
    games,
    pcs,
    onlinePcs,
    deployments,
    gameId,
    versionId,
    masterPcId,
    targets,
    setGameId,
    setVersionId,
    setMasterPcId,
    toggleTarget,
    handleSubmit,
    createPending,
  };
}
