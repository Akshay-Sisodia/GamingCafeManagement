import type { PcDetailDto } from "../../lib/types";
import { HealthBar } from "./HealthBar";

export function PcHealthPanel({ pc }: { pc: PcDetailDto }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-medium text-zinc-400">Health</h2>
      {pc.health ? (
        <div className="mt-4 space-y-4">
          <HealthBar label="CPU" pct={pc.health.cpu_pct} />
          <HealthBar label="RAM" pct={pc.health.ram_pct} />
          <HealthBar label="GPU" pct={pc.health.gpu_pct ?? null} />
          <HealthBar label="Disk" pct={pc.health.disk_pct} />
          <p className="pt-1 text-xs text-zinc-500">
            agent status: {pc.health.agent_status} · uptime{" "}
            {Math.floor(pc.health.uptime_s / 3600)}h {Math.floor((pc.health.uptime_s % 3600) / 60)}m
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">No health report received yet.</p>
      )}
    </section>
  );
}
