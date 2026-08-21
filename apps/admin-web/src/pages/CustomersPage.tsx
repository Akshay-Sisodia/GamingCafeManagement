import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { CustomerDto } from "../lib/types";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { CustomersTable } from "./customers/CustomersTable";

export function CustomersPage() {
  const customersQuery = useQuery({
    queryKey: ["customers"],
    queryFn: () => api<CustomerDto[]>("/customers"),
  });

  if (customersQuery.isLoading) return <LoadingBlock />;
  if (customersQuery.isError) {
    return (
      <ErrorState
        message={customersQuery.error instanceof Error ? customersQuery.error.message : undefined}
        onRetry={() => void customersQuery.refetch()}
      />
    );
  }

  const customers = customersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Customers</h1>
      {customers.length === 0 ? (
        <p className="text-sm text-zinc-500">No customers registered yet.</p>
      ) : (
        <CustomersTable customers={customers} />
      )}
    </div>
  );
}
