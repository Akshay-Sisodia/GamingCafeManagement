function parseAddItemInput(name: string, price: string, prepMinutes: string, categoryId: string) {
  const priceRupees = Number.parseFloat(price);
  const prep = Number.parseInt(prepMinutes, 10);
  if (!name.trim() || !categoryId || Number.isNaN(priceRupees) || priceRupees <= 0 || Number.isNaN(prep)) {
    return null;
  }
  return {
    category_id: categoryId,
    name: name.trim(),
    price_amount: Math.round(priceRupees * 100),
    prep_minutes: prep,
  };
}

export { parseAddItemInput };
