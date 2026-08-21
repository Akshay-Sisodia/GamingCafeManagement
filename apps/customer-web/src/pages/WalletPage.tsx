import { Wallet } from "lucide-react";

export function WalletPage() {
  return (
    <div className="space-y-4 p-4 pb-28">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <Wallet className="h-10 w-10 text-emerald-400" />
        <h2 className="text-lg font-semibold text-zinc-100">Wallet</h2>
        <p className="text-sm text-zinc-400">Coming soon — top-ups and balance will appear here.</p>
      </div>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <h2 className="text-lg font-semibold text-zinc-100">Loyalty</h2>
        <p className="text-sm text-zinc-400">
          Coming soon — earn points for every rupee you spend at the café.
        </p>
      </div>
    </div>
  );
}
