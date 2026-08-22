import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toasts";

export function useAddCategory(onCreated?: () => void) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const createCategory = useMutation({
    mutationFn: (body: { name: string; display_order: number }) =>
      api("/menu/categories", { method: "POST", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["menu"] });
      setName("");
      onCreated?.();
      toast.push("Category added");
    },
    onError: (error) =>
      toast.push(error instanceof Error ? error.message : "Could not add category", "error"),
  });

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.push("Enter a category name.", "error");
      return;
    }
    createCategory.mutate({ name: trimmed, display_order: 0 });
  }

  return { name, setName, submit, pending: createCategory.isPending };
}
