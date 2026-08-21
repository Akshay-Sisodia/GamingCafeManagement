import type { GameDto } from "../../lib/types";

export function GameCatalog({ games }: { games: GameDto[] }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-medium text-zinc-400">Game catalog</h2>
      {games.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No games in the catalog.</p>
      ) : (
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-zinc-500">
              <th className="pb-2">Name</th>
              <th className="pb-2">Platform</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {games.map((game) => (
              <tr key={game.id}>
                <td className="py-2 text-zinc-200">{game.name}</td>
                <td className="py-2 text-zinc-400">{game.platform}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
