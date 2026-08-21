import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { MenuCategoryDto } from "../../lib/types";
import { useToast } from "../../components/Toasts";

export function useMenuPatch() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ id, available }: { id: string; available: boolean }) =>
      api(`/menu/items/${id}`, { method: "PATCH", body: { available } }),
    onMutate: async ({ id, available }) => {
      await queryClient.cancelQueries({ queryKey: ["menu"] });
      const previous = queryClient.getQueryData<MenuCategoryDto[]>(["menu"]);
      queryClient.setQueryData<MenuCategoryDto[]>(["menu"], (old) =>
        old?.map((category) => ({
          ...category,
          items: category.items.map((item) =>
            item.id === id ? { ...item, available } : item,
          ),
        })),
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(["menu"], context.previous);
      toast.push(error instanceof Error ? error.message : "Update failed", "error");
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useMenuPage() {
  const [addOpen, setAddOpen] = useState(false);
  const menuQuery = useQuery({ queryKey: ["menu"], queryFn: () => api<MenuCategoryDto[]>("/menu") });
  const patchItem = useMenuPatch();

  return {
    addOpen,
    setAddOpen,
    menuQuery,
    patchItem,
    categories: menuQuery.data ?? [],
  };
}
