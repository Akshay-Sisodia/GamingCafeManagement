import { useKitchenOrders } from "./useKitchenOrders";
import { useKitchenSSE } from "./useKitchenSSE";

export function useKitchenPage() {
  const connected = useKitchenSSE();
  const orders = useKitchenOrders();
  return { connected, ...orders };
}
