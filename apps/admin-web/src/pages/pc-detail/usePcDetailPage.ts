import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { PcDetailDto } from "../../lib/types";
import { usePcSessionMutations } from "./usePcSessionMutations";

export function usePcDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [confirmEnd, setConfirmEnd] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["pc", id],
    queryFn: () => api<PcDetailDto>(`/pcs/${id}`),
    enabled: id !== "",
  });

  const { extend, endSession, busy } = usePcSessionMutations(id, () => setConfirmEnd(false));

  const pc = detailQuery.data;
  const session = pc?.current_session;

  return {
    detailQuery,
    pc,
    session,
    busy,
    confirmEnd,
    setConfirmEnd,
    extend,
    endSession,
  };
}
