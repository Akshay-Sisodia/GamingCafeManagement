import { CalendarClock } from "lucide-react";

export function SessionsPage() {
  return (
    <div className="p-4 pb-28">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <CalendarClock className="h-10 w-10 text-emerald-400" />
        <h2 className="text-lg font-semibold text-zinc-100">Sessions</h2>
        <p className="text-sm text-zinc-400">Coming soon — track your play time and bookings here.</p>
      </div>
    </div>
  );
}
