import type { CustomerDto } from "../../lib/types";
import { formatDateTime, formatMoney } from "../../lib/format";

export function CustomersTable({ customers }: { customers: CustomerDto[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Wallet</th>
            <th className="px-4 py-3">Loyalty</th>
            <th className="px-4 py-3">Joined</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {customers.map((customer) => (
            <tr key={customer.id} className="hover:bg-zinc-900/60">
              <td className="px-4 py-3 font-medium text-zinc-100">{customer.name}</td>
              <td className="px-4 py-3 text-zinc-400">{customer.email ?? "—"}</td>
              <td className="px-4 py-3 text-zinc-400">{customer.phone ?? "—"}</td>
              <td className="px-4 py-3 text-zinc-300">{formatMoney(customer.wallet_balance)}</td>
              <td className="px-4 py-3 text-zinc-300">{customer.loyalty_points} pts</td>
              <td className="px-4 py-3 text-zinc-500">{formatDateTime(customer.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
