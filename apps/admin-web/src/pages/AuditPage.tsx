import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { AuditLogDto } from "../lib/types";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { AuditFilters } from "./audit/AuditFilters";
import { AuditLogTable } from "./audit/AuditLogTable";

export function AuditPage() {
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ action: "", from: "", to: "" });

  const logsQuery = useQuery({
    queryKey: ["audit", applied],
    queryFn: () => {
      const params = new URLSearchParams();
      if (applied.action) params.set("action", applied.action);
      if (applied.from) params.set("from", applied.from);
      if (applied.to) params.set("to", applied.to);
      const qs = params.toString();
      return api<AuditLogDto[]>(`/audit-logs${qs ? `?${qs}` : ""}`);
    },
  });

  function handleApply(event: FormEvent) {
    event.preventDefault();
    setApplied({ action, from, to });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
      <AuditFilters
        action={action}
        from={from}
        to={to}
        onActionChange={setAction}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={handleApply}
      />
      {logsQuery.isLoading ? (
        <LoadingBlock />
      ) : logsQuery.isError ? (
        <ErrorState
          message={logsQuery.error instanceof Error ? logsQuery.error.message : undefined}
          onRetry={() => void logsQuery.refetch()}
        />
      ) : (logsQuery.data ?? []).length === 0 ? (
        <p className="text-sm text-zinc-500">No audit entries match these filters.</p>
      ) : (
        <AuditLogTable logs={logsQuery.data ?? []} />
      )}
    </div>
  );
}
