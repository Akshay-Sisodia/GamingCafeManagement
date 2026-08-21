import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toasts";
import { parseAddItemInput } from "./parseAddItemInput";

export function useAddItemModal(onClose: () => void) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [prepMinutes, setPrepMinutes] = useState("10");
  const [categoryId, setCategoryId] = useState("");

  const createItem = useMutation({
    mutationFn: (body: {
      category_id: string;
      name: string;
      price_amount: number;
      prep_minutes: number;
    }) => api("/menu/items", { method: "POST", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["menu"] });
      setName("");
      setPrice("");
      setPrepMinutes("10");
      onClose();
      toast.push("Menu item added");
    },
    onError: (error) =>
      toast.push(error instanceof Error ? error.message : "Could not add item", "error"),
  });

  function submit() {
    const body = parseAddItemInput(name, price, prepMinutes, categoryId);
    if (!body) {
      toast.push("Fill in a valid name, price and prep time.", "error");
      return;
    }
    createItem.mutate(body);
  }

  return {
    name,
    price,
    prepMinutes,
    categoryId,
    setName,
    setPrice,
    setPrepMinutes,
    setCategoryId,
    submit,
    pending: createItem.isPending,
  };
}
