import { useQuery } from "@tanstack/react-query";
import { Activity, Armchair, Monitor, Receipt, WifiOff } from "lucide-react";
import { api } from "../lib/api";
import type { DashboardDto } from "../lib/types";
import { formatMoney } from "../lib/format";
import { Tile } from "../components/Tile";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";

export function DashboardPage() {
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardDto>("/dashboard"),
  });

  if (dashboardQuery.isLoading) return <LoadingBlock />;
  if (dashboardQuery.isError) {
    return (
      <ErrorState
        message={dashboardQuery.error instanceof Error ? dashboardQuery.error.message : undefined}
        onRetry={() => void dashboardQuery.refetch()}
      />
    );
  }

  const data = dashboardQuery.data;
  if (!data) return <ErrorState message="No data received." onRetry={() => void dashboardQuery.refetch()} />;

  const occupancy =
    data.pcs_total > 0 ? `${Math.round((data.pcs_occupied / data.pcs_total) * 100)}%` : "0%";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tile label="Revenue today" value={formatMoney(data.revenue_today)} icon={<Activity className="h-5 w-5" />} />
        <Tile
          label="PC occupancy"
          value={`${data.pcs_occupied} / ${data.pcs_total}`}
          hint={`${occupancy} of floor occupied`}
          icon={<Monitor className="h-5 w-5" />}
        />
        <Tile label="Active sessions" value={data.active_sessions} icon={<Armchair className="h-5 w-5" />} />
        <Tile label="Pending orders" value={data.pending_orders} icon={<Receipt className="h-5 w-5" />} />
        <Tile
          label="Offline PCs"
          value={data.offline_pcs}
          hint={data.offline_pcs > 0 ? "Needs attention" : "All good"}
          icon={<WifiOff className="h-5 w-5" />}
        />
      </div>
    </div>
  );
}
