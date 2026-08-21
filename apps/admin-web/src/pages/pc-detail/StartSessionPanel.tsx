import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toasts";
import { StartSessionPresets } from "./StartSessionPresets";

export function StartSessionPanel({ pcId, disabled }: { pcId: string; disabled: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [minutes, setMinutes] = useState(60);

  const start = useMutation({
    mutationFn: (plannedMinutes: number) =>
      api("/sessions", { method: "POST", body: { pc_id: pcId, planned_minutes: plannedMinutes } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pc", pcId] });
      void queryClient.invalidateQueries({ queryKey: ["pcs"] });
      toast.push("Session started");
    },
    onError: (error) => toast.push(error instanceof Error ? error.message : "Start failed", "error"),
  });

  return (
    <StartSessionPresets
      minutes={minutes}
      disabled={disabled}
      pending={start.isPending}
      onPreset={setMinutes}
      onMinutesChange={setMinutes}
      onStart={() => start.mutate(minutes)}
    />
  );
}
